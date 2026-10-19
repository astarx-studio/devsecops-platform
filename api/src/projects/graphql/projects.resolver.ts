import { UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';

import { AppConfiguration } from '../../config';

import { CombinedAuthGuard } from '../../common/guards';
import { ConfigsService } from '../../configs/configs.service';
import { TemplatesService } from '../../templates/templates.service';
import { EnvProfileService } from '../env/env-profile.service';
import { SlugService } from '../slug.service';
import { ProjectsService } from '../projects.service';
import { DeleteProjectOutcome, Env, EnvProfileContentMode } from './enums';
import {
  CreateProjectInput,
  ProjectFilterInput,
  MigrateProjectToAutoDevopsInput,
  RegisterGitLabProjectInput,
  UpdateProjectSonarConfigInput,
  UpdateEnvProfileContentInput,
  UpdateEnvProfileMetadataInput,
  UploadEnvProfileInput,
  UpsertDeploymentTargetInput,
} from './project.inputs';
import {
  AppContainerLogsType,
  AuditLogType,
  ConfigType,
  DeleteProjectResultType,
  EnvProfileContentType,
  EnvProfileType,
  ReconcileGitLabProjectsResultType,
  DeploymentTargetType,
  ProjectSonarType,
  ProjectType,
  UpsertDeploymentTargetPayload,
  SonarBranchProvisionType,
  SonarGatePolicyType,
  TemplateType,
} from './project.type';
import { ensureDeploymentTargets } from '../deploy/deploy-target.util';
import { buildSonarProjectKey } from '../sonar/sonar-project-key.util';
import { isSonarEnabled, resolveSonarGatePolicy } from '../sonar/sonar.types';

import type { EnvProfile, ProjectDocument } from '../schemas/project.schema';

function mapSonar(doc: ProjectDocument, dashboardBaseUrl?: string): ProjectSonarType | undefined {
  if (!isSonarEnabled(doc.sonar)) {
    return undefined;
  }
  const gatePolicy = resolveSonarGatePolicy(doc.sonar?.gatePolicy);
  const firstBranch = doc.sonar!.allowedBranches[0];
  const dashboardUrl =
    dashboardBaseUrl && firstBranch
      ? `${dashboardBaseUrl}/dashboard?id=${encodeURIComponent(buildSonarProjectKey(doc.gitlabPath, firstBranch))}`
      : undefined;

  return {
    allowedBranches: doc.sonar!.allowedBranches,
    gatePolicy: gatePolicy as SonarGatePolicyType,
    dashboardUrl,
  };
}

/**
 * Maps a Mongoose ProjectDocument to the GraphQL ProjectType.
 * Handles the `id` ← `_id` conversion and enum coercion.
 */
function mapEnvProfile(profile: EnvProfile): EnvProfileType {
  return {
    id: profile.id,
    label: profile.label,
    injectionPhase: profile.injectionPhase as EnvProfileType['injectionPhase'],
    branches: profile.branches,
    deploymentTargetKeys: profile.deploymentTargetKeys,
    jobSelector: profile.jobSelector,
    workspacePath: profile.workspacePath,
    filename: profile.filename,
    buildDelivery: profile.buildDelivery as EnvProfileType['buildDelivery'],
    vaultPath: profile.vaultPath,
    contentType: profile.contentType,
    keyNames: profile.keyNames ?? [],
    updatedAt: profile.updatedAt,
  };
}

function mapDeploymentTargets(
  doc: ProjectDocument,
  appsDomain: string,
): DeploymentTargetType[] {
  return ensureDeploymentTargets(
    {
      deploymentTargets: doc.deploymentTargets,
      effectiveSlug: doc.effectiveSlug,
      capabilities: doc.capabilities,
      appHosts: doc.appHosts,
      hostnameOverrides: doc.hostnameOverrides,
    },
    appsDomain,
  ).map((t) => ({
    key: t.key,
    kubeNamespace: t.kubeNamespace,
    clusterProfile: t.clusterProfile as DeploymentTargetType['clusterProfile'],
    appHost: t.appHost,
    apps: (t.apps ?? []).map((app) => ({
      name: app.name,
      image: app.image,
      dockerfile: app.dockerfile,
      host: app.host,
    })),
    deployRef: t.deployRef,
    enabled: t.enabled,
    gitlabEnvironment: t.gitlabEnvironment,
  }));
}

function mapProject(
  doc: ProjectDocument,
  sonarPublicUrl?: string,
  appsDomain?: string,
): ProjectType {
  return {
    id: String(doc._id),
    gitlabProjectId: doc.gitlabProjectId,
    gitlabPath: doc.gitlabPath,
    groupPath: doc.groupPath,
    projectSlug: doc.projectSlug,
    effectiveSlug: doc.effectiveSlug,
    displayName: doc.displayName,
    provisioning: doc.provisioning as ProjectType['provisioning'],
    templateSlug: doc.templateSlug,
    vaultBasePath: doc.vaultBasePath,
    helmReleaseName: doc.helmReleaseName,
    appsDomain: appsDomain ?? '',
    appHosts: {
      dev: doc.appHosts?.dev,
      stg: doc.appHosts?.stg,
      prod: doc.appHosts?.prod,
    },
    deploymentTargets: appsDomain ? mapDeploymentTargets(doc, appsDomain) : [],
    capabilities: {
      deployable: doc.capabilities?.deployable ?? false,
      publishable: doc.capabilities?.publishable ?? false,
    },
    sonar: mapSonar(doc, sonarPublicUrl),
    envProfiles: (doc.envProfiles ?? []).map(mapEnvProfile),
    runtimeEnvEnabled: doc.runtimeEnvEnabled ?? true,
    legacyV1: doc.legacyV1,
    pinnedV1: doc.pinnedV1,
    archived: doc.archived ?? false,
    archivedAt: doc.archivedAt,
    archiveReason: doc.archiveReason,
    gitlabDeleteError: doc.gitlabDeleteError,
    createdAt: doc.createdAt!,
    updatedAt: doc.updatedAt!,
  };
}

/**
 * GraphQL resolver for all project-related queries and mutations.
 * All operations are protected by `CombinedAuthGuard` (API key or OIDC JWT).
 */
@UseGuards(CombinedAuthGuard)
@Resolver(() => ProjectType)
export class ProjectsResolver {
  private readonly sonarPublicUrl: string;
  private readonly appsDomain: string;

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly envProfileService: EnvProfileService,
    private readonly slugService: SlugService,
    private readonly templatesService: TemplatesService,
    private readonly configsService: ConfigsService,
    configService: ConfigService<AppConfiguration>,
  ) {
    this.sonarPublicUrl = configService.get<string>('sonarqube.publicUrl', { infer: true })!;
    this.appsDomain = configService.get<string>('appsDomain', { infer: true })!;
  }

  private mapDoc(doc: ProjectDocument): ProjectType {
    return mapProject(doc, this.sonarPublicUrl, this.appsDomain);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  @Query(() => [ProjectType], {
    description: 'Returns a paginated list of projects with optional filtering.',
  })
  async projects(
    @Args('filter', { type: () => ProjectFilterInput, nullable: true })
    filter?: ProjectFilterInput,
    @Args('page', { type: () => Int, nullable: true, defaultValue: 0 })
    page?: number,
    @Args('perPage', { type: () => Int, nullable: true, defaultValue: 50 })
    perPage?: number,
  ): Promise<ProjectType[]> {
    const docs = await this.projectsService.listProjects(filter, page, perPage);
    return docs.map((d) => this.mapDoc(d));
  }

  @Query(() => ProjectType, {
    nullable: true,
    description:
      'Finds a single project by MongoDB ID, GitLab path, or effective slug. ' +
      'Exactly one argument must be provided.',
  })
  async project(
    @Args('id', { type: () => ID, nullable: true }) id?: string,
    @Args('gitlabPath', { nullable: true }) gitlabPath?: string,
    @Args('effectiveSlug', { nullable: true }) effectiveSlug?: string,
  ): Promise<ProjectType | null> {
    try {
      const doc = await this.projectsService.findProject({ id, gitlabPath, effectiveSlug });
      return this.mapDoc(doc);
    } catch {
      return null;
    }
  }

  @Query(() => Boolean, {
    description: 'Returns true if the given slug is not yet taken by any project.',
  })
  async slugAvailable(@Args('slug') slug: string): Promise<boolean> {
    return this.slugService.isAvailable(slug);
  }

  @Query(() => [TemplateType], {
    description: 'Returns all template repos from the GitLab templates group.',
  })
  async templates(): Promise<TemplateType[]> {
    const items = await this.templatesService.listTemplates();
    return items.map((t) => ({
      id: t.id,
      slug: t.slug,
      description: t.description,
      gitlabUrl: t.gitlabUrl,
      defaultBranch: t.defaultBranch,
    }));
  }

  @Query(() => [ConfigType], {
    description: 'Returns all shared CI/CD config repos from the GitLab configs group.',
  })
  async configs(): Promise<ConfigType[]> {
    const items = await this.configsService.listConfigs();
    return items.map((c) => ({
      id: c.id,
      slug: c.slug,
      description: c.description,
      gitlabUrl: c.gitlabUrl,
    }));
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  @Mutation(() => ProjectType, {
    description:
      'Provisions a new project end-to-end: GitLab group hierarchy, project creation, ' +
      'Vault secret seeding, k3d namespace check, CI variable setup, and MongoDB persistence.',
  })
  async createProject(@Args('input') input: CreateProjectInput): Promise<ProjectType> {
    const doc = await this.projectsService.createProject(input);
    return this.mapDoc(doc);
  }

  @Mutation(() => ProjectType, {
    description:
      'Opt in to SonarQube for specific branches, sync CI variables, and optionally store the analysis token in Vault.',
  })
  async updateProjectSonarConfig(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateProjectSonarConfigInput,
  ): Promise<ProjectType> {
    const doc = await this.projectsService.updateProjectSonarConfig(id, input);
    return this.mapDoc(doc);
  }

  @Mutation(() => [SonarBranchProvisionType], {
    description:
      'Creates SonarQube analysis projects for the given Git branches (idempotent). ' +
      'Project keys match the Auto DevOps pipeline. Optionally updates SONAR_ALLOWED_BRANCHES.',
  })
  async provisionSonarProjects(
    @Args('id', { type: () => ID }) id: string,
    @Args('branches', { type: () => [String] }) branches: string[],
    @Args('addToAllowedBranches', {
      type: () => Boolean,
      nullable: true,
      defaultValue: true,
      description:
        'When true (default), merges branches into the project Sonar allowlist and syncs GitLab CI variables.',
    })
    addToAllowedBranches?: boolean,
  ): Promise<SonarBranchProvisionType[]> {
    return this.projectsService.provisionSonarProjects(id, branches, addToAllowedBranches ?? true);
  }

  @Mutation(() => Boolean, {
    description:
      'Deletes SonarQube analysis projects for the given branches (best-effort). ' +
      'When pruneAllowlist is true (default), those branches are removed from the Mongo allowlist and GitLab CI. ' +
      'An empty allowlist also clears SONAR_TOKEN in GitLab CI (Vault copy is kept for reuse).',
  })
  async deleteSonarProjects(
    @Args('id', { type: () => ID }) id: string,
    @Args('branches', { type: () => [String] }) branches: string[],
    @Args('pruneAllowlist', {
      type: () => Boolean,
      nullable: true,
      defaultValue: true,
      description: 'Remove branches from the allowlist and resync CI. Default true.',
    })
    pruneAllowlist?: boolean,
  ): Promise<boolean> {
    await this.projectsService.deleteSonarProjects(id, branches, pruneAllowlist ?? true);
    return true;
  }

  @Mutation(() => ReconcileGitLabProjectsResultType, {
    description:
      'Scans GitLab for projects missing from the registry and backfills them as legacyV1. ' +
      'Also archives active registry rows whose GitLab project is pending deletion. ' +
      'Does not run on API startup — invoke explicitly when needed.',
  })
  async reconcileGitLabProjects(): Promise<ReconcileGitLabProjectsResultType> {
    return this.projectsService.reconcileGitLabProjects();
  }

  @Mutation(() => ProjectType, {
    description:
      'Registers an existing GitLab project by numeric ID with optional deployment wiring.',
  })
  async registerGitLabProject(
    @Args('input') input: RegisterGitLabProjectInput,
  ): Promise<ProjectType> {
    const doc = await this.projectsService.registerGitLabProject(input);
    return this.mapDoc(doc);
  }

  @Mutation(() => UpsertDeploymentTargetPayload, {
    description: 'Creates or updates a named deployment target (dev, prod-alt, etc.).',
  })
  async upsertDeploymentTarget(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpsertDeploymentTargetInput,
  ): Promise<UpsertDeploymentTargetPayload> {
    const { doc, ciSyncWarnings } = await this.projectsService.upsertDeploymentTarget(id, input);
    return {
      project: this.mapDoc(doc),
      ciSyncWarnings,
    };
  }

  @Mutation(() => ProjectType, {
    description: 'Removes a deployment target and tears down its K8s resources.',
  })
  async removeDeploymentTarget(
    @Args('id', { type: () => ID }) id: string,
    @Args('targetKey') targetKey: string,
    @Args('teardownK8s', { nullable: true, defaultValue: true }) teardownK8s: boolean,
  ): Promise<ProjectType> {
    const doc = await this.projectsService.removeDeploymentTarget(id, targetKey, teardownK8s);
    return this.mapDoc(doc);
  }

  @Mutation(() => ProjectType, {
    description:
      'Sets the primary app hostname for a deployment target (apps[0].host and appHost) and updates APP_HOST CI scopes. Prefer upsertDeploymentTarget when editing the full app list.',
  })
  async setDeploymentTargetHostname(
    @Args('id', { type: () => ID }) id: string,
    @Args('targetKey') targetKey: string,
    @Args('hostname') hostname: string,
  ): Promise<ProjectType> {
    const doc = await this.projectsService.setDeploymentTargetHostname(id, targetKey, hostname);
    return this.mapDoc(doc);
  }

  @Mutation(() => DeleteProjectResultType, {
    description:
      'Unregisters a project: tears down K8s/Vault/Sonar, then deletes GitLab. ' +
      'Archives the registry row when GitLab, Kubernetes, Vault, or Sonar resources still exist. ' +
      'Archived rows are not proof that teardown finished — retry runs platform cleanup unless skipPlatformCleanup is true. ' +
      'Removes the Mongo row when nothing remains.',
  })
  async deleteProject(
    @Args('id', { type: () => ID }) id: string,
    @Args('forceGitLabDelete', {
      type: () => Boolean,
      nullable: true,
      defaultValue: false,
      description: 'Purge container registry and packages before GitLab project delete.',
    })
    forceGitLabDelete?: boolean,
    @Args('skipPlatformCleanup', {
      type: () => Boolean,
      nullable: true,
      defaultValue: false,
      description:
        'Skip K8s/Vault/Sonar teardown (GitLab-only retry). Default false, including for archived projects.',
    })
    skipPlatformCleanup?: boolean,
  ): Promise<DeleteProjectResultType> {
    const result = await this.projectsService.deleteProject(id, {
      forceGitLabDelete: forceGitLabDelete ?? false,
      skipPlatformCleanup: skipPlatformCleanup ?? false,
    });

    return {
      outcome:
        result.outcome === 'deleted' ? DeleteProjectOutcome.DELETED : DeleteProjectOutcome.ARCHIVED,
      message: result.message,
      project: result.project ? this.mapDoc(result.project) : undefined,
    };
  }

  @Mutation(() => ProjectType, {
    description:
      'Migrates a legacy v1 project to the Auto DevOps pipeline. ' +
      'Writes .gitlab-ci.yml, sets CI vars, and triggers the pipeline. ' +
      'Compose-side cleanup for fully migrated projects is handled separately after prod is stable.',
  })
  async migrateProjectToAutoDevops(
    @Args('id', { type: () => ID }) id: string,
    @Args('input', { nullable: true }) input?: MigrateProjectToAutoDevopsInput,
  ): Promise<ProjectType> {
    const doc = await this.projectsService.migrateProjectToAutoDevops(
      id,
      input?.branchOptions,
      input?.unpin ?? false,
    );
    return this.mapDoc(doc);
  }

  @Mutation(() => ProjectType, {
    description:
      'Sets or clears the pinnedV1 flag so a legacy project can stay on v1 compose until unpinned.',
  })
  async setPinnedV1(
    @Args('id', { type: () => ID }) id: string,
    @Args('pinned') pinned: boolean,
  ): Promise<ProjectType> {
    const doc = await this.projectsService.setPinnedV1(id, pinned);
    return this.mapDoc(doc);
  }

  @Mutation(() => ProjectType, {
    description:
      'Legacy alias of setDeploymentTargetHostname for dev/stg/prod keys. ' +
      'Writes apps[0].host so later reads do not mask the override.',
  })
  async setHostnameOverride(
    @Args('id', { type: () => ID }) id: string,
    @Args('env', { type: () => Env }) env: Env,
    @Args('hostname') hostname: string,
  ): Promise<ProjectType> {
    const doc = await this.projectsService.setHostnameOverride(id, env, hostname);
    return this.mapDoc(doc);
  }

  @Query(() => [AuditLogType], {
    description:
      'Recent lifecycle audit events (newest first). Actor is api-key or oidc user when known. No secret values.',
  })
  async auditLogs(
    @Args('projectId', { type: () => ID, nullable: true }) projectId?: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 50 }) limit?: number,
  ): Promise<AuditLogType[]> {
    const rows = await this.projectsService.listAuditLogs(projectId, limit ?? 50);
    return rows.map((row) => ({
      id: String(row._id),
      eventType: row.eventType,
      projectId: row.projectId,
      gitlabPath: row.gitlabPath,
      effectiveSlug: row.effectiveSlug,
      actor: row.actor,
      metadata: row.metadata,
      createdAt: row.createdAt ? row.createdAt.toISOString() : undefined,
    }));
  }

  @Query(() => AppContainerLogsType, {
    description:
      'Tails logs for the Helm release of one app on a deployment target. ' +
      'Namespace and cluster are taken from the project record.',
  })
  appContainerLogs(
    @Args('id', { type: () => ID }) id: string,
    @Args('targetKey') targetKey: string,
    @Args('appName', { nullable: true }) appName?: string,
    @Args('tailLines', { type: () => Int, nullable: true, defaultValue: 100 }) tailLines?: number,
    @Args('previous', { type: () => Boolean, nullable: true, defaultValue: false })
    previous?: boolean,
    @Args('container', { nullable: true }) container?: string,
    @Args('follow', {
      type: () => Boolean,
      nullable: true,
      defaultValue: false,
      description: 'Live refresh. Skips the audit write so a tail does not record every poll.',
    })
    follow?: boolean,
  ): Promise<AppContainerLogsType> {
    return this.projectsService.readAppContainerLogs(
      id,
      targetKey,
      appName,
      tailLines ?? 100,
      previous === true,
      container,
      follow === true,
    );
  }

  @Query(() => [EnvProfileType], {
    description:
      'Lists branch-scoped env profiles for a project (metadata only; secrets in Vault).',
  })
  async envProfiles(
    @Args('projectId', { type: () => ID }) projectId: string,
  ): Promise<EnvProfileType[]> {
    const profiles = await this.envProfileService.listProfiles(projectId);
    return profiles.map(mapEnvProfile);
  }

  @Mutation(() => EnvProfileType, {
    description:
      'Uploads a branch-scoped env profile to Vault (build-time file/args or runtime KV per target).',
  })
  async uploadEnvProfile(
    @Args('projectId', { type: () => ID }) projectId: string,
    @Args('input') input: UploadEnvProfileInput,
  ): Promise<EnvProfileType> {
    const profile = await this.envProfileService.uploadProfile(projectId, {
      label: input.label,
      injectionPhase: input.injectionPhase,
      branches: input.branches,
      content: input.content,
      deploymentTargetKeys: input.deploymentTargetKeys,
      jobSelector: input.jobSelector,
      workspacePath: input.workspacePath,
      filename: input.filename,
      buildDelivery: input.buildDelivery,
      contentType: input.contentType,
    });
    return mapEnvProfile(profile);
  }

  @Mutation(() => ProjectType, {
    description: 'Deletes an env profile from Mongo and Vault; updates chart-values when needed.',
  })
  async deleteEnvProfile(
    @Args('projectId', { type: () => ID }) projectId: string,
    @Args('profileId') profileId: string,
  ): Promise<ProjectType> {
    const doc = await this.envProfileService.deleteProfile(projectId, profileId);
    return this.mapDoc(doc);
  }

  @Query(() => EnvProfileContentType, {
    description:
      'Loads Vault secret body for one env profile (plaintext for authorized operators; list stays metadata-only).',
  })
  async envProfileContent(
    @Args('projectId', { type: () => ID }) projectId: string,
    @Args('profileId') profileId: string,
  ): Promise<EnvProfileContentType> {
    const content = await this.envProfileService.getProfileContent(projectId, profileId);
    return {
      profileId: content.profileId,
      mode:
        content.mode === 'raw_file' ? EnvProfileContentMode.RAW_FILE : EnvProfileContentMode.DOTENV,
      entries: content.entries,
      rawContent: content.rawContent,
    };
  }

  @Mutation(() => EnvProfileType, {
    description:
      'Replaces env profile secret content in Vault in place (same profileId; updates RUNTIME target merges).',
  })
  async updateEnvProfileContent(
    @Args('projectId', { type: () => ID }) projectId: string,
    @Args('profileId') profileId: string,
    @Args('input') input: UpdateEnvProfileContentInput,
  ): Promise<EnvProfileType> {
    const profile = await this.envProfileService.updateProfileContent(
      projectId,
      profileId,
      input.content,
    );
    return mapEnvProfile(profile);
  }

  @Mutation(() => EnvProfileType, {
    description:
      'Updates env profile metadata (label, branches, targets, build path) without a new profile id.',
  })
  async updateEnvProfileMetadata(
    @Args('projectId', { type: () => ID }) projectId: string,
    @Args('profileId') profileId: string,
    @Args('input') input: UpdateEnvProfileMetadataInput,
  ): Promise<EnvProfileType> {
    const profile = await this.envProfileService.updateProfileMetadata(projectId, profileId, input);
    return mapEnvProfile(profile);
  }
}
