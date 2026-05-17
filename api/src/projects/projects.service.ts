import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';

import type { QueryFilter, Model } from 'mongoose';

import { AppConfiguration } from '../config';
import { GitLabService } from '../gitlab/gitlab.service';
import { isGitLabProjectPendingDeletion } from '../gitlab/gitlab-project.util';
import { K8sService } from '../k8s/k8s.service';
import { VaultService } from '../vault/vault.service';
import {
  buildGitlabCiWithIncludes,
  generateDeployTargetsCiYaml,
  DEPLOY_TARGETS_CI_PATH,
} from './deploy/deploy-ci-generator';
import { DEPLOY_REF_DISABLED, STANDARD_DEPLOY_TARGET_KEYS } from './deploy/deploy.constants';
import {
  appHostsFromTargets,
  assertValidActiveDeployRef,
  assertValidTargetKey,
  buildDefaultAppHost,
  deriveStandardDeploymentTargets,
  ensureDeploymentTargets,
  inferClusterProfile,
  resolveDefaultDeployRef,
} from './deploy/deploy-target.util';
import {
  buildDeployRefVariable,
  buildDeploymentTargetFromInput,
  buildEnvScopedDeployVariables,
  ENV_SCOPED_DEPLOY_VAR_KEYS,
} from './deploy/deployment-wiring';
import type { DeleteProjectOptions, DeleteProjectResult } from './delete-project-result';
import {
  CreateProjectInput,
  DeploymentTargetInput,
  ProjectFilterInput,
  RegisterGitLabProjectInput,
  UpdateProjectSonarConfigInput,
  UpsertDeploymentTargetInput,
} from './graphql/project.inputs';
import { Provisioning } from './graphql/enums';
import { AuditLog } from './schemas/audit-log.schema';
import { Project, ProjectDocument } from './schemas/project.schema';
import type { ClusterProfile, DeployEnv, DeploymentTarget } from './schemas/project.schema';
import { SonarQubeService } from '../sonarqube/sonarqube.service';
import { SlugService } from './slug.service';
import { buildSonarCiVariables } from './sonar/sonar-ci-sync';
import {
  buildSonarProjectKey,
  buildSonarProjectName,
} from './sonar/sonar-project-key.util';
import {
  isSonarEnabled,
  resolveSonarGatePolicy,
  type ProjectSonarConfig,
  type SonarGatePolicy,
} from './sonar/sonar.types';

/** Result of provisioning one Sonar project for a Git branch. */
export interface SonarBranchProvisionResult {
  branch: string;
  projectKey: string;
  projectName: string;
  created: boolean;
  dashboardUrl: string;
}

/** Standard deployment target keys (template includes jobs for these). */
const DEPLOY_ENVS: DeployEnv[] = ['dev', 'stg', 'prod'];

/**
 * Core provisioning service for the v2 platform.
 *
 * Orchestrates project creation, deletion, migration, and slug resolution
 * across GitLab, Vault, MongoDB, and the k3d Kubernetes cluster.
 *
 * Create flow:
 *  1. Resolve effective slug (SlugService)
 *  2. Create GitLab group hierarchy
 *  3. Provision GitLab project (create + write CI files, or fork template)
 *  4. Seed Vault secrets (base path + per-env envScopedVars)
 *  5. Ensure k3d namespaces exist (dev/stg/prod)
 *  6. Set env-scoped CI variables on the GitLab project
 *  7. Persist Project document to MongoDB
 *  8. Write AuditLog entry
 *
 * Delete flow:
 *  1. Delete GitLab project (critical)
 *  2. Delete Vault secrets (non-critical)
 *  3. Remove MongoDB document
 *  4. Write AuditLog entry
 *
 * Startup reconciliation (4.10):
 *  Scans GitLab for projects without a Mongo record → backfills as legacyV1=true.
 */
@Injectable()
export class ProjectsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly domain: string;
  private readonly appsDomain: string;

  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<Project>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
    private readonly gitlabService: GitLabService,
    private readonly vaultService: VaultService,
    private readonly k8sService: K8sService,
    private readonly slugService: SlugService,
    private readonly sonarQubeService: SonarQubeService,
    private readonly configService: ConfigService<AppConfiguration>,
  ) {
    this.domain = this.configService.get<string>('domain', { infer: true })!;
    this.appsDomain = this.configService.get<string>('appsDomain', { infer: true })!;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds the Auto DevOps `.gitlab-ci.yml` include content from config.
   * Reading from config allows the shared pipeline project path to be overridden
   * via AUTO_DEVOPS_PIPELINE_PROJECT / AUTO_DEVOPS_PIPELINE_FILE env vars.
   *
   * @returns YAML string for the `.gitlab-ci.yml` include block
   */
  private buildAutoDevopsCi(hasExtraTargets = false): string {
    const project = this.configService.get<string>('autoDevops.pipelineProject', { infer: true })!;
    const file = this.configService.get<string>('autoDevops.pipelineFile', { infer: true })!;
    this.logger.verbose(`buildAutoDevopsCi: project="${project}" file="${file}"`);
    return buildGitlabCiWithIncludes(project, file, hasExtraTargets);
  }

  /**
   * Resolves deployment targets for a new or updated project document.
   */
  private resolveInitialDeploymentTargets(
    effectiveSlug: string,
    deployable: boolean,
    inputTargets?: DeploymentTargetInput[],
    appHosts?: { dev?: string; stg?: string; prod?: string },
  ): DeploymentTarget[] {
    if (inputTargets?.length) {
      return inputTargets.map((t) =>
        buildDeploymentTargetFromInput(t, effectiveSlug, this.appsDomain, deployable),
      );
    }
    const standard = deriveStandardDeploymentTargets(
      effectiveSlug,
      this.appsDomain,
      deployable,
      appHosts,
    );
    return standard;
  }

  private hasExtraDeployTargets(targets: DeploymentTarget[]): boolean {
    return targets.some(
      (t) => !(STANDARD_DEPLOY_TARGET_KEYS as readonly string[]).includes(t.key),
    );
  }

  private syncAppHostsFromTargets(doc: ProjectDocument): void {
    doc.appHosts = appHostsFromTargets(ensureDeploymentTargets(doc, this.appsDomain));
  }

  private recomputeDeployable(doc: ProjectDocument): void {
    const targets = ensureDeploymentTargets(doc, this.appsDomain);
    doc.deploymentTargets = targets;
    doc.capabilities.deployable = targets.some((t) => t.enabled);
  }

  /**
   * Generates the Helm values overlay committed to the project repo.
   * Project metadata (path, env, host) is injected at deploy time by the pipeline
   * via --set flags; this file is for per-app overrides only (probes, resources, etc.).
   *
   * @returns YAML comment block for chart-values.yaml
   */
  private static buildChartValues(): string {
    return `# Chart value overrides for the dsoaas-app Helm chart.
# Committed by the platform API during project provisioning.
# Project metadata (path, env, host) is injected by the pipeline at deploy time
# via --set flags; do not duplicate it here.
# Use this file for app-specific overrides: probes, resources, replicaCount, extraEnv.
`;
  }

  /**
   * Computes the default app hostnames for a project based on its effective slug.
   *
   * URL scheme:
   *  - dev:  {effectiveSlug}.dev.apps.{DOMAIN}
   *  - stg:  {effectiveSlug}.stg.apps.{DOMAIN}
   *  - prod: {effectiveSlug}.apps.{DOMAIN}  (no env prefix for production)
   *
   * @param effectiveSlug - Resolved slug
   * @returns Object with dev/stg/prod hostnames
   */
  private buildAppHosts(effectiveSlug: string): Record<DeployEnv, string> {
    return {
      dev: `${effectiveSlug}.dev.${this.appsDomain}`,
      stg: `${effectiveSlug}.stg.${this.appsDomain}`,
      prod: `${effectiveSlug}.${this.appsDomain}`,
    };
  }

  /**
   * Derives a human-readable display name from a slug when none is provided.
   * e.g. "my-app" → "My App"
   *
   * @param slug - Project slug
   * @returns Title-cased display name
   */
  private static slugToDisplayName(slug: string): string {
    return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Startup hook: reconcile legacy v1 projects from GitLab into MongoDB.
   * Runs in the background after module initialisation completes.
   */
  onApplicationBootstrap(): void {
    setImmediate(() => {
      this.reconcileLegacyProjects().catch((err: Error) => {
        this.logger.error(`Startup reconciliation failed: ${err.message}`, err.stack);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Returns a paginated list of projects, optionally filtered.
   *
   * @param filter - Optional filter criteria
   * @param page - Zero-based page index (default 0)
   * @param perPage - Page size (default 50)
   */
  async listProjects(
    filter?: ProjectFilterInput,
    page = 0,
    perPage = 50,
  ): Promise<ProjectDocument[]> {
    const query: QueryFilter<Project> = {};

    if (filter?.groupPathPrefix?.length) {
      const prefix = filter.groupPathPrefix;
      for (let i = 0; i < prefix.length; i++) {
        query[`groupPath.${i}`] = prefix[i];
      }
    }

    if (filter?.legacyV1 !== undefined) {
      query['legacyV1'] = filter.legacyV1;
    }
    if (filter?.pinnedV1 !== undefined) {
      query['pinnedV1'] = filter.pinnedV1;
    }

    if (filter?.archived === true) {
      query['archived'] = true;
    } else {
      query['archived'] = { $in: [false, null] };
    }

    this.logger.debug(
      `listProjects: filter=${JSON.stringify(filter)} page=${page} perPage=${perPage}`,
    );

    return this.projectModel
      .find(query)
      .skip(page * perPage)
      .limit(perPage)
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Finds a single project by MongoDB ID, GitLab path, or effective slug.
   * Exactly one lookup field must be provided.
   *
   * @throws NotFoundException if no project matches the criteria
   */
  async findProject(criteria: {
    id?: string;
    gitlabPath?: string;
    effectiveSlug?: string;
  }): Promise<ProjectDocument> {
    const { id, gitlabPath, effectiveSlug } = criteria;

    let doc: ProjectDocument | null = null;

    if (id) {
      doc = await this.projectModel.findById(id).exec();
    } else if (gitlabPath) {
      doc = await this.projectModel.findOne({ gitlabPath }).exec();
    } else if (effectiveSlug) {
      doc = await this.projectModel.findOne({ effectiveSlug }).exec();
    }

    if (!doc) {
      const label = id ?? gitlabPath ?? effectiveSlug ?? '(none)';
      throw new NotFoundException(`Project not found: ${label}`);
    }

    return doc;
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Provisions a new project end-to-end across GitLab, Vault, k3d, and MongoDB.
   *
   * @param input - Project creation parameters
   * @returns The persisted Project document
   */
  async createProject(input: CreateProjectInput): Promise<ProjectDocument> {
    const {
      groupPath,
      projectSlug,
      displayName,
      provisioning = Provisioning.AUTO_DEVOPS,
      templateSlug,
      capabilities,
      slugOverride,
    } = input;

    const isDeployable = capabilities?.deployable ?? true;
    const isPublishable = capabilities?.publishable ?? false;
    // Derive a readable name when the caller doesn't provide one
    const resolvedDisplayName = displayName ?? ProjectsService.slugToDisplayName(projectSlug);

    this.logger.log(
      `createProject: groupPath=[${groupPath.join('/')}] slug="${projectSlug}" ` +
        `provisioning=${provisioning} deployable=${isDeployable} publishable=${isPublishable}`,
    );

    // Step 1: Resolve effective slug
    this.logger.log('Step 1: Resolving effective slug');
    const effectiveSlug = await this.slugService.resolve(projectSlug, groupPath, slugOverride);
    this.logger.log(`Effective slug resolved: "${effectiveSlug}"`);

    const gitlabPath = [...groupPath, projectSlug].join('/');
    const vaultBasePath = `projects/${[...groupPath, projectSlug].join('/')}`;
    const helmReleaseName = effectiveSlug;

    const appHosts = this.buildAppHosts(effectiveSlug);
    const deploymentTargets = this.resolveInitialDeploymentTargets(
      effectiveSlug,
      isDeployable,
      input.deploymentTargets,
      appHosts,
    );
    const hasExtraTargets = this.hasExtraDeployTargets(deploymentTargets);

    // Step 2: Create GitLab group hierarchy
    this.logger.log(`Step 2: Ensuring GitLab group hierarchy: ${groupPath.join('/')}`);
    const groupId = await this.gitlabService.createGroupHierarchy(groupPath);

    // Step 3: Provision GitLab project
    let gitlabProjectId: number;

    if (provisioning === Provisioning.TEMPLATE) {
      if (!templateSlug) {
        throw new ConflictException('templateSlug is required when provisioning=TEMPLATE');
      }
      this.logger.log(
        `Step 3: Forking template "${templateSlug}" into group ${groupId} as "${projectSlug}"`,
      );
      const forked = await this.gitlabService.forkTemplate(templateSlug, groupId, projectSlug);
      gitlabProjectId = forked.id;
    } else {
      this.logger.log(
        `Step 3: Creating new Auto DevOps project "${projectSlug}" in group ${groupId}`,
      );
      const created = await this.gitlabService.createNewProject(
        groupId,
        projectSlug,
        resolvedDisplayName,
        true,
      );
      gitlabProjectId = created.id;

      // Write .gitlab-ci.yml (Auto DevOps include) and chart-values.yaml
      this.logger.log('Step 3a: Writing .gitlab-ci.yml with Auto DevOps include');
      await this.gitlabService.upsertFile(
        gitlabProjectId,
        '.gitlab-ci.yml',
        this.buildAutoDevopsCi(hasExtraTargets),
        'chore: add Auto DevOps pipeline include',
      );

      if (isDeployable) {
        this.logger.log('Step 3b: Writing chart-values.yaml');
        await this.gitlabService.upsertFile(
          gitlabProjectId,
          'chart-values.yaml',
          ProjectsService.buildChartValues(),
          'chore: add chart-values.yaml for dsoaas-app Helm chart',
        );
      }
    }

    // Step 4: Seed Vault secrets
    this.logger.log(`Step 4: Seeding Vault secrets at "${vaultBasePath}"`);
    const baseSecrets: Record<string, string> = {
      PROJECT_SLUG: projectSlug,
      EFFECTIVE_SLUG: effectiveSlug,
      GITLAB_PROJECT_ID: String(gitlabProjectId),
      GITLAB_PATH: gitlabPath,
    };
    // envVars is now a validated JSON object (not a raw string) — merge directly
    if (input.envVars) {
      Object.assign(baseSecrets, input.envVars);
    }
    await this.vaultService.writeSecrets(vaultBasePath, baseSecrets);

    // Step 4b: Per-env Vault writes — always executed so every deploy environment
    // has a populated secret path.  Sentinel keys (DEPLOY_ENV, VAULT_PROJECT_PATH)
    // ensure the ExternalSecret can sync even when no caller-supplied values exist.
    // Additional caller-supplied keys from envScopedVars are merged on top.
    const envScopedEnvsWritten: string[] = [];
    for (const target of deploymentTargets) {
      const envPath = `${vaultBasePath}/${target.key}`;

      const envData: Record<string, string> = {
        DEPLOY_ENV: target.key,
        VAULT_PROJECT_PATH: vaultBasePath,
      };

      const raw = input.envScopedVars?.[target.key as DeployEnv];
      if (raw) {
        try {
          Object.assign(envData, JSON.parse(raw) as Record<string, string>);
          envScopedEnvsWritten.push(target.key);
        } catch (err) {
          this.logger.warn(
            `envScopedVars.${target.key} is not valid JSON — keeping sentinels only: ${(err as Error).message}`,
          );
        }
      }

      await this.vaultService.writeSecrets(envPath, envData);
      this.logger.log(
        `Step 4b: Seeded Vault at "${envPath}" (${Object.keys(envData).length} keys)`,
      );
    }

    this.logger.log('Step 5: Ensuring Kubernetes namespaces for deployment targets');
    await Promise.all(
      deploymentTargets.map((t) =>
        this.k8sService.ensureNamespace(t.clusterProfile, t.kubeNamespace),
      ),
    );

    if (isDeployable || deploymentTargets.some((t) => t.enabled)) {
      this.logger.log('Step 6: Setting deployment CI variables on GitLab project');
      const ciVariables = deploymentTargets.flatMap((target) => {
        const kubeconfigB64 = this.k8sService.getKubeconfigB64(target.clusterProfile);
        if (!kubeconfigB64) {
          this.logger.warn(
            `KUBECONFIG_B64 missing for profile="${target.clusterProfile}" (target ${target.key})`,
          );
        }
        return [
          ...buildEnvScopedDeployVariables(target, vaultBasePath, kubeconfigB64),
          buildDeployRefVariable(target),
        ];
      });
      await this.gitlabService.setProjectCiVariables(gitlabProjectId, ciVariables);

      if (hasExtraTargets) {
        const extraYaml = generateDeployTargetsCiYaml(deploymentTargets);
        if (extraYaml) {
          await this.gitlabService.upsertFile(
            gitlabProjectId,
            DEPLOY_TARGETS_CI_PATH,
            extraYaml,
            'chore: add deployment targets CI (DSOaaS)',
          );
        }
      }
    }

    // Step 7: Persist to MongoDB
    this.logger.log('Step 7: Persisting project to MongoDB');
    const doc = await this.projectModel.create({
      gitlabProjectId,
      gitlabPath,
      groupPath,
      projectSlug,
      effectiveSlug,
      displayName: resolvedDisplayName,
      provisioning,
      templateSlug: provisioning === Provisioning.TEMPLATE ? templateSlug : undefined,
      vaultBasePath,
      helmReleaseName,
      appHosts: appHostsFromTargets(deploymentTargets),
      hostnameOverrides: {},
      deploymentTargets,
      capabilities: {
        deployable: deploymentTargets.some((t) => t.enabled),
        publishable: isPublishable,
      },
      legacyV1: false,
      pinnedV1: false,
    });

    // Step 8: Audit log
    await this.auditLogModel.create({
      eventType: 'project.created',
      projectId: String(doc._id),
      gitlabPath,
      effectiveSlug,
      metadata: {
        provisioning,
        deployable: isDeployable,
        publishable: isPublishable,
        ...(envScopedEnvsWritten.length > 0 && { envScopedVars: envScopedEnvsWritten }),
      },
    });

    if (input.sonar?.allowedBranches?.length) {
      await this.updateProjectSonarConfig(String(doc._id), input.sonar);
      return this.findProject({ id: String(doc._id) });
    }

    this.logger.log(
      `Project "${gitlabPath}" provisioned successfully (id=${String(doc._id)}, slug="${effectiveSlug}")`,
    );
    return doc;
  }

  /**
   * Deletes a project and associated platform resources.
   *
   * When GitLab delete fails (often due to container registry), the MongoDB record is
   * marked archived instead of removed so operators can retry with force delete.
   *
   * @param id - MongoDB document ID
   * @param options.forceGitLabDelete - purge registry/packages before GitLab delete
   * @param options.skipPlatformCleanup - skip K8s/Vault/Sonar (retry on archived project)
   */
  async deleteProject(id: string, options?: DeleteProjectOptions): Promise<DeleteProjectResult> {
    const forceGitLabDelete = options?.forceGitLabDelete ?? false;
    const skipPlatformCleanup =
      options?.skipPlatformCleanup ?? false;

    this.logger.log(
      `deleteProject: id=${id} forceGitLab=${forceGitLabDelete} skipPlatform=${skipPlatformCleanup}`,
    );
    const doc = await this.findProject({ id });
    const skipPlatform = skipPlatformCleanup || doc.archived;

    if (!skipPlatform) {
      const targets = ensureDeploymentTargets(doc, this.appsDomain);

      try {
        this.logger.log(`Tearing down K8s releases for "${doc.helmReleaseName}"`);
        await this.k8sService.teardownProjectTargets(doc.helmReleaseName, targets);
      } catch (err) {
        this.logger.warn(`K8s teardown failed (non-critical): ${(err as Error).message}`);
      }

      try {
        this.logger.log(
          `Deleting Vault secret tree at "${doc.vaultBasePath}" (base + env/sonar paths)`,
        );
        const vaultResult = await this.vaultService.deleteSecretsTree(doc.vaultBasePath);
        if (vaultResult.errors.length > 0) {
          this.logger.warn(
            `Vault cleanup incomplete for "${doc.vaultBasePath}": ` +
              `${vaultResult.errors.join('; ')}`,
          );
        }
      } catch (err) {
        this.logger.warn(`Vault cleanup failed (non-critical): ${(err as Error).message}`);
      }

      if (isSonarEnabled(doc.sonar) && this.sonarQubeService.isConfigured()) {
        try {
          await this.deleteSonarProjects(id, doc.sonar!.allowedBranches);
        } catch (err) {
          this.logger.warn(`Sonar cleanup failed (non-critical): ${(err as Error).message}`);
        }
      }
    }

    const gitlabResult = await this.gitlabService.tryDeleteProject(doc.gitlabProjectId, {
      force: forceGitLabDelete,
    });

    if (!gitlabResult.ok) {
      const message = gitlabResult.message ?? 'GitLab project delete failed';
      this.logger.warn(
        `GitLab project ${doc.gitlabProjectId} could not be deleted: ${message}. ` +
          (doc.archived ? 'Updating archived record.' : 'Archiving platform record.'),
      );

      if (!doc.archived) {
        doc.archived = true;
        doc.archivedAt = new Date();
        doc.archiveReason = 'gitlab_delete_failed';
        doc.gitlabDeleteError = message;
        await doc.save();

        await this.auditLogModel.create({
          eventType: 'project.archived',
          projectId: id,
          gitlabPath: doc.gitlabPath,
          effectiveSlug: doc.effectiveSlug,
          metadata: {
            gitlabDeleteError: message,
            forceGitLabDelete,
            platformCleanupPerformed: !skipPlatform,
          },
        });

        this.logger.log(`Project "${doc.gitlabPath}" archived (GitLab repo may still exist)`);
        return { outcome: 'archived', message, project: doc };
      }

      doc.gitlabDeleteError = message;
      await doc.save();
      return { outcome: 'archived', message, project: doc };
    }

    await this.auditLogModel.create({
      eventType: 'project.deleted',
      projectId: id,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: {
        gitlabDeleted: true,
        forceGitLabDelete,
        wasArchived: doc.archived ?? false,
      },
    });

    await doc.deleteOne();

    this.logger.log(`Project "${doc.gitlabPath}" unregistered from platform`);
    return { outcome: 'deleted' };
  }

  /**
   * Migrates a legacy v1 project to the Auto DevOps pipeline:
   *  1. Writes `.gitlab-ci.yml` with Auto DevOps include
   *  2. Sets env-scoped CI variables
   *  3. Triggers the pipeline
   *  4. Sets `legacyV1 = false` in MongoDB
   *
   * Note: stopping the legacy compose stack and removing its gateway routes
   * is a separate operator step after a successful production deploy on k3d.
   *
   * @param id - MongoDB document ID
   */
  async migrateProjectToAutoDevops(id: string): Promise<ProjectDocument> {
    this.logger.log(`migrateProjectToAutoDevops: id=${id}`);
    const doc = await this.findProject({ id });

    if (!doc.legacyV1) {
      this.logger.warn(`Project "${doc.gitlabPath}" is not a legacy v1 project — skipping`);
      return doc;
    }

    // Step 1: Write Auto DevOps .gitlab-ci.yml
    this.logger.log(`Writing .gitlab-ci.yml for project ${doc.gitlabProjectId}`);
    if (!doc.deploymentTargets?.length) {
      doc.deploymentTargets = deriveStandardDeploymentTargets(
        doc.effectiveSlug,
        this.appsDomain,
        doc.capabilities.deployable,
        doc.appHosts,
        doc.hostnameOverrides,
      );
    }

    await this.gitlabService.upsertFile(
      doc.gitlabProjectId,
      'chart-values.yaml',
      ProjectsService.buildChartValues(),
      'chore: add chart-values.yaml for v2 Auto DevOps',
    );

    if (doc.capabilities.deployable || doc.deploymentTargets.some((t) => t.enabled)) {
      await this.syncAllDeploymentWiring(doc);
    } else {
      await this.gitlabService.upsertFile(
        doc.gitlabProjectId,
        '.gitlab-ci.yml',
        this.buildAutoDevopsCi(false),
        'chore: migrate to Auto DevOps pipeline',
      );
    }

    // Step 3: Trigger pipeline on default branch
    try {
      this.logger.log(`Triggering pipeline for project ${doc.gitlabProjectId}`);
      await this.gitlabService.triggerPipeline(doc.gitlabProjectId);
    } catch (err) {
      this.logger.warn(`Pipeline trigger failed (non-critical): ${(err as Error).message}`);
    }

    // Step 4: Update MongoDB
    doc.legacyV1 = false;
    await doc.save();

    await this.auditLogModel.create({
      eventType: 'project.migrated',
      projectId: id,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: {},
    });

    this.logger.log(`Project "${doc.gitlabPath}" migrated to Auto DevOps`);
    return doc;
  }

  /**
   * Overrides the hostname for one environment on an existing project.
   * Updates `hostnameOverrides`, `appHosts`, and the `APP_HOST` CI variable.
   *
   * @param id - MongoDB document ID
   * @param env - Target environment
   * @param hostname - New hostname
   */
  async setHostnameOverride(
    id: string,
    targetKey: string,
    hostname: string,
  ): Promise<ProjectDocument> {
    this.logger.log(
      `setHostnameOverride: id=${id} target=${targetKey} hostname="${hostname}"`,
    );
    const doc = await this.findProject({ id });
    const targets = ensureDeploymentTargets(doc, this.appsDomain);
    const idx = targets.findIndex((t) => t.key === targetKey);
    if (idx < 0) {
      throw new NotFoundException(`Deployment target "${targetKey}" not found`);
    }

    targets[idx] = { ...targets[idx], appHost: hostname };
    doc.deploymentTargets = targets;

    if (targetKey === 'dev' || targetKey === 'stg' || targetKey === 'prod') {
      doc.hostnameOverrides = { ...(doc.hostnameOverrides ?? {}), [targetKey]: hostname };
    }
    this.syncAppHostsFromTargets(doc);
    await doc.save();

    const scope = targets[idx].gitlabEnvironment ?? targetKey;
    try {
      await this.gitlabService.setProjectCiVariable(
        doc.gitlabProjectId,
        'APP_HOST',
        hostname,
        scope,
        false,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to update APP_HOST CI var (non-critical): ${(err as Error).message}`,
      );
    }

    await this.auditLogModel.create({
      eventType: 'project.hostname_override',
      projectId: id,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: { targetKey, hostname },
    });

    return doc;
  }

  /**
   * Sets or clears the `pinnedV1` flag on a project.
   *
   * @param id - MongoDB document ID
   * @param pinned - Whether to pin the project on v1 indefinitely
   */
  /**
   * Enables, updates, or disables SonarQube for a project.
   * Persists MongoDB state, writes token to Vault when provided, and syncs GitLab CI variables.
   *
   * @param id - MongoDB project document ID
   * @param input - Branch allowlist, optional gate policy, optional analysis token
   */
  async updateProjectSonarConfig(
    id: string,
    input: UpdateProjectSonarConfigInput,
  ): Promise<ProjectDocument> {
    this.logger.log(
      `updateProjectSonarConfig: id=${id} branches=[${input.allowedBranches.join(',')}]`,
    );
    const doc = await this.findProject({ id });

    const gatePolicy = resolveSonarGatePolicy(
      input.gatePolicy
        ? {
            dev: input.gatePolicy.dev as SonarGatePolicy['dev'] | undefined,
            stg: input.gatePolicy.stg as SonarGatePolicy['stg'] | undefined,
            prod: input.gatePolicy.prod as SonarGatePolicy['prod'] | undefined,
            other: input.gatePolicy.other as SonarGatePolicy['other'] | undefined,
          }
        : doc.sonar?.gatePolicy,
    );

    const sonarConfig: ProjectSonarConfig | undefined =
      input.allowedBranches.length > 0
        ? { allowedBranches: [...input.allowedBranches], gatePolicy }
        : undefined;

    doc.sonar = sonarConfig;
    await doc.save();

    const publicUrl = this.configService.get<string>('sonarqube.publicUrl', { infer: true })!;
    const internalUrl = this.configService.get<string>('sonarqube.internalUrl', { infer: true })!;

    await this.syncSonarCiToGitLab(doc, sonarConfig, input.sonarToken);

    await this.auditLogModel.create({
      eventType: 'project.sonar_config_updated',
      projectId: id,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: {
        gitlabProjectId: doc.gitlabProjectId,
        allowedBranches: input.allowedBranches,
        gatePolicy,
        sonarEnabled: isSonarEnabled(sonarConfig),
      },
    });

    this.logger.log(`Sonar config updated for "${doc.gitlabPath}"`);
    return doc;
  }

  /**
   * Resolves a Sonar analysis token: explicit input, Vault, or auto-generated global token.
   */
  private async resolveSonarAnalysisToken(
    doc: ProjectDocument,
    explicitToken?: string,
  ): Promise<string | undefined> {
    if (explicitToken?.trim()) {
      return explicitToken.trim();
    }

    const vaultPath = `${doc.vaultBasePath}/sonar`;
    const stored = await this.vaultService.readSecrets(vaultPath);
    if (stored.SONAR_TOKEN) {
      this.logger.debug(`Using Sonar token from Vault at secret/data/${vaultPath}`);
      return stored.SONAR_TOKEN;
    }

    if (!this.sonarQubeService.isConfigured()) {
      return undefined;
    }

    const baseName = `dsoaas-gitlab-${doc.gitlabProjectId}`;
    let token: string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const name = attempt === 0 ? baseName : `${baseName}-${attempt}`;
      try {
        token = await this.sonarQubeService.generateGlobalAnalysisToken(name);
        break;
      } catch (err) {
        this.logger.warn(
          `Sonar token generation attempt ${attempt + 1} failed: ${(err as Error).message}`,
        );
      }
    }

    if (!token) {
      throw new BadRequestException(
        'Could not create a Sonar analysis token. Set SONAR_ADMIN_USER/PASSWORD on the API or provide sonarToken manually.',
      );
    }

    await this.vaultService.writeSecrets(vaultPath, { SONAR_TOKEN: token });
    this.logger.log(`Sonar analysis token stored at secret/data/${vaultPath}`);
    return token;
  }

  /**
   * Writes Sonar-related GitLab CI variables (branches, URLs, token).
   */
  private async syncSonarCiToGitLab(
    doc: ProjectDocument,
    sonarConfig: ProjectSonarConfig | undefined,
    explicitToken?: string,
  ): Promise<void> {
    const publicUrl = this.configService.get<string>('sonarqube.publicUrl', { infer: true })!;
    const internalUrl = this.configService.get<string>('sonarqube.internalUrl', { infer: true })!;

    let token: string | undefined;
    if (isSonarEnabled(sonarConfig)) {
      token = await this.resolveSonarAnalysisToken(doc, explicitToken);
      if (!token) {
        this.logger.warn(
          `Sonar enabled for "${doc.gitlabPath}" but no SONAR_TOKEN — CI sonar:scan will skip until a token is set.`,
        );
      }
    }

    const ciVars = buildSonarCiVariables(sonarConfig, {
      publicUrl,
      internalUrl,
      token,
    });
    await this.gitlabService.setProjectCiVariables(doc.gitlabProjectId, ciVars);
  }

  /**
   * Creates SonarQube analysis projects for the given Git branches (idempotent).
   *
   * Keys match the Auto DevOps pipeline (`CI_PROJECT_PATH_SLUG` + branch). Optionally
   * merges branches into the project's Sonar allowlist and syncs GitLab CI variables.
   *
   * @param id - MongoDB project ID
   * @param branches - Git branch names (e.g. main, staging, develop)
   * @param addToAllowedBranches - When true, union branches into `project.sonar` and sync CI
   * @returns Per-branch provision results with dashboard URLs
   */
  async provisionSonarProjects(
    id: string,
    branches: string[],
    addToAllowedBranches = true,
  ): Promise<SonarBranchProvisionResult[]> {
    if (!branches.length) {
      throw new BadRequestException('At least one branch is required to provision Sonar projects.');
    }

    const normalizedBranches = [...new Set(branches.map((b) => b.trim()).filter(Boolean))];
    if (!normalizedBranches.length) {
      throw new BadRequestException('At least one non-empty branch name is required.');
    }

    this.logger.log(
      `provisionSonarProjects: id=${id} branches=[${normalizedBranches.join(',')}]`,
    );
    const doc = await this.findProject({ id });
    const publicUrl = this.configService.get<string>('sonarqube.publicUrl', { infer: true })!;
    const projectLabel = doc.displayName ?? doc.projectSlug;
    const results: SonarBranchProvisionResult[] = [];

    for (const branch of normalizedBranches) {
      const projectKey = buildSonarProjectKey(doc.gitlabPath, branch);
      const projectName = buildSonarProjectName(projectLabel, branch);
      const { created } = await this.sonarQubeService.ensureProject(
        projectKey,
        projectName,
        branch,
      );
      results.push({
        branch,
        projectKey,
        projectName,
        created,
        dashboardUrl: `${publicUrl}/dashboard?id=${encodeURIComponent(projectKey)}`,
      });
    }

    if (addToAllowedBranches) {
      const existing = doc.sonar?.allowedBranches ?? [];
      const merged = [...new Set([...existing, ...normalizedBranches])];
      const gatePolicy = resolveSonarGatePolicy(doc.sonar?.gatePolicy);
      doc.sonar = { allowedBranches: merged, gatePolicy };
      await doc.save();

      await this.syncSonarCiToGitLab(doc, doc.sonar);
    }

    await this.auditLogModel.create({
      eventType: 'project.sonar_provisioned',
      projectId: id,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: {
        branches: normalizedBranches,
        provisioned: results.map((r) => ({
          branch: r.branch,
          projectKey: r.projectKey,
          created: r.created,
        })),
        addToAllowedBranches,
      },
    });

    this.logger.log(
      `Provisioned ${results.length} Sonar project(s) for "${doc.gitlabPath}"`,
    );
    return results;
  }

  /**
   * Deletes SonarQube analysis projects for the given branches (best-effort).
   *
   * @param id - MongoDB project ID
   * @param branches - Git branch names whose Sonar keys should be removed
   */
  async deleteSonarProjects(id: string, branches: string[]): Promise<void> {
    const doc = await this.findProject({ id });
    for (const branch of branches) {
      const projectKey = buildSonarProjectKey(doc.gitlabPath, branch);
      try {
        await this.sonarQubeService.deleteProject(projectKey);
      } catch (err) {
        this.logger.warn(
          `Sonar delete failed for ${projectKey} (non-critical): ${(err as Error).message}`,
        );
      }
    }

    await this.auditLogModel.create({
      eventType: 'project.sonar_deleted',
      projectId: id,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: { branches },
    });
  }

  /**
   * Builds the public Sonar dashboard URL for a GitLab path and branch.
   */
  getSonarDashboardUrl(gitlabPath: string, branch: string): string | undefined {
    const publicUrl = this.configService.get<string>('sonarqube.publicUrl', { infer: true });
    if (!publicUrl) {
      return undefined;
    }
    const projectKey = buildSonarProjectKey(gitlabPath, branch);
    return `${publicUrl}/dashboard?id=${encodeURIComponent(projectKey)}`;
  }

  async setPinnedV1(id: string, pinned: boolean): Promise<ProjectDocument> {
    this.logger.log(`setPinnedV1: id=${id} pinned=${pinned}`);
    const doc = await this.findProject({ id });
    doc.pinnedV1 = pinned;
    await doc.save();

    await this.auditLogModel.create({
      eventType: 'project.pinned_v1',
      projectId: id,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: { pinned },
    });

    return doc;
  }

  // ---------------------------------------------------------------------------
  // Deployment target wiring
  // ---------------------------------------------------------------------------

  /**
   * Seeds Vault paths and syncs GitLab CI + generated deploy jobs for all targets.
   */
  private async syncAllDeploymentWiring(doc: ProjectDocument): Promise<void> {
    const targets = ensureDeploymentTargets(doc, this.appsDomain);
    doc.deploymentTargets = targets;
    this.syncAppHostsFromTargets(doc);

    for (const target of targets) {
      await this.seedVaultForTarget(doc, target);
      await this.k8sService.ensureNamespace(target.clusterProfile, target.kubeNamespace);
    }

    const ciVars = targets.flatMap((target) => {
      const kubeconfigB64 = this.k8sService.getKubeconfigB64(target.clusterProfile);
      return [
        ...buildEnvScopedDeployVariables(target, doc.vaultBasePath, kubeconfigB64),
        buildDeployRefVariable(target),
      ];
    });

    if (ciVars.length > 0) {
      await this.gitlabService.setProjectCiVariables(doc.gitlabProjectId, ciVars);
    }

    await this.regenerateDeployCiFiles(doc);
    this.recomputeDeployable(doc);
    await doc.save();
  }

  private async seedVaultForTarget(doc: ProjectDocument, target: DeploymentTarget): Promise<void> {
    const envPath = `${doc.vaultBasePath}/${target.key}`;
    await this.vaultService.writeSecrets(envPath, {
      DEPLOY_ENV: target.key,
      VAULT_PROJECT_PATH: doc.vaultBasePath,
    });
  }

  private async regenerateDeployCiFiles(doc: ProjectDocument): Promise<void> {
    const targets = ensureDeploymentTargets(doc, this.appsDomain);
    const extraYaml = generateDeployTargetsCiYaml(targets);
    const hasExtra = this.hasExtraDeployTargets(targets);

    if (hasExtra && extraYaml) {
      await this.gitlabService.upsertFile(
        doc.gitlabProjectId,
        DEPLOY_TARGETS_CI_PATH,
        extraYaml,
        'chore: update deployment targets CI (DSOaaS)',
      );
    }

    await this.gitlabService.upsertFile(
      doc.gitlabProjectId,
      '.gitlab-ci.yml',
      this.buildAutoDevopsCi(hasExtra),
      'chore: sync Auto DevOps pipeline include',
    );
  }

  /**
   * Registers an existing GitLab project in the platform registry with optional deploy wiring.
   */
  async registerGitLabProject(input: RegisterGitLabProjectInput): Promise<ProjectDocument> {
    const glProject = await this.gitlabService.getProject(input.gitlabProjectId).catch(() => {
      throw new NotFoundException(`GitLab project id=${input.gitlabProjectId} not found`);
    });

    if (isGitLabProjectPendingDeletion(glProject)) {
      throw new BadRequestException(
        `GitLab project "${glProject.path_with_namespace}" is scheduled for deletion and cannot be registered`,
      );
    }

    const existing = await this.projectModel
      .findOne({ gitlabProjectId: input.gitlabProjectId })
      .exec();
    if (existing) {
      throw new ConflictException(
        `GitLab project ${input.gitlabProjectId} is already registered (mongo id=${String(existing._id)})`,
      );
    }

    const parts = glProject.path_with_namespace.split('/');
    const derivedSlug = parts.at(-1)!;
    const derivedGroupPath = parts.slice(0, -1);
    const projectSlug = input.projectSlug ?? derivedSlug;
    const groupPath = input.groupPath ?? derivedGroupPath;
    const gitlabPath = [...groupPath, projectSlug].join('/');
    const isDeployable = input.capabilities?.deployable ?? false;
    const isPublishable = input.capabilities?.publishable ?? false;

    const effectiveSlug = await this.slugService.resolve(
      projectSlug,
      groupPath,
      input.slugOverride,
    );
    const vaultBasePath = `projects/${gitlabPath}`;
    const appHosts = this.buildAppHosts(effectiveSlug);
    const deploymentTargets = this.resolveInitialDeploymentTargets(
      effectiveSlug,
      isDeployable,
      input.deploymentTargets,
      appHosts,
    );

    const doc = await this.projectModel.create({
      gitlabProjectId: input.gitlabProjectId,
      gitlabPath,
      groupPath,
      projectSlug,
      effectiveSlug,
      displayName: input.displayName ?? glProject.name,
      provisioning: input.provisioning ?? Provisioning.AUTO_DEVOPS,
      vaultBasePath,
      helmReleaseName: effectiveSlug,
      appHosts: appHostsFromTargets(deploymentTargets),
      hostnameOverrides: {},
      deploymentTargets,
      capabilities: { deployable: isDeployable, publishable: isPublishable },
      legacyV1: false,
      pinnedV1: false,
    });

    if (input.envVars) {
      await this.vaultService.writeSecrets(vaultBasePath, {
        PROJECT_SLUG: projectSlug,
        EFFECTIVE_SLUG: effectiveSlug,
        GITLAB_PROJECT_ID: String(input.gitlabProjectId),
        GITLAB_PATH: gitlabPath,
        ...input.envVars,
      });
    }

    if (isDeployable || deploymentTargets.some((t) => t.enabled)) {
      await this.gitlabService.upsertFile(
        doc.gitlabProjectId,
        'chart-values.yaml',
        ProjectsService.buildChartValues(),
        'chore: add chart-values.yaml for DSOaaS',
      );
      await this.syncAllDeploymentWiring(doc);
    }

    await this.auditLogModel.create({
      eventType: 'project.registered',
      projectId: String(doc._id),
      gitlabPath,
      effectiveSlug,
      metadata: { gitlabProjectId: input.gitlabProjectId },
    });

    if (input.sonar?.allowedBranches?.length) {
      return this.updateProjectSonarConfig(String(doc._id), input.sonar);
    }

    return this.findProject({ id: String(doc._id) });
  }

  async upsertDeploymentTarget(
    id: string,
    input: UpsertDeploymentTargetInput,
  ): Promise<ProjectDocument> {
    const doc = await this.findProject({ id });
    assertValidTargetKey(input.targetKey);

    let targets = ensureDeploymentTargets(doc, this.appsDomain);
    const idx = targets.findIndex((t) => t.key === input.targetKey);
    const existing = idx >= 0 ? targets[idx] : undefined;

    const clusterProfile =
      (input.clusterProfile as ClusterProfile | undefined) ??
      existing?.clusterProfile ??
      inferClusterProfile(input.targetKey);

    if (!clusterProfile) {
      throw new BadRequestException(
        `clusterProfile is required for target "${input.targetKey}"`,
      );
    }

    let deployRef = input.deployRef ?? existing?.deployRef;
    if (input.enabled) {
      deployRef = deployRef ?? resolveDefaultDeployRef(input.targetKey);
      if (!deployRef) {
        throw new BadRequestException(
          `deployRef is required when enabling custom target "${input.targetKey}"`,
        );
      }
    } else {
      deployRef = DEPLOY_REF_DISABLED;
    }

    assertValidActiveDeployRef(deployRef, input.enabled);

    const target: DeploymentTarget = {
      key: input.targetKey,
      kubeNamespace: input.kubeNamespace ?? existing?.kubeNamespace ?? input.targetKey,
      clusterProfile,
      appHost:
        input.appHost ??
        existing?.appHost ??
        buildDefaultAppHost(input.targetKey, doc.effectiveSlug, this.appsDomain),
      deployRef,
      enabled: input.enabled,
      gitlabEnvironment: existing?.gitlabEnvironment ?? input.targetKey,
    };

    if (idx >= 0) {
      targets[idx] = target;
    } else {
      targets = [...targets, target];
    }

    if (!input.enabled && (input.teardownK8sOnDisable ?? true)) {
      await this.k8sService.teardownRelease(
        target.clusterProfile,
        target.kubeNamespace,
        doc.helmReleaseName,
      );
    }

    doc.deploymentTargets = targets;
    await this.seedVaultForTarget(doc, target);
    await this.k8sService.ensureNamespace(target.clusterProfile, target.kubeNamespace);

    const kubeconfigB64 = this.k8sService.getKubeconfigB64(target.clusterProfile);
    await this.gitlabService.setProjectCiVariables(doc.gitlabProjectId, [
      ...buildEnvScopedDeployVariables(target, doc.vaultBasePath, kubeconfigB64),
      buildDeployRefVariable(target),
    ]);

    await this.regenerateDeployCiFiles(doc);
    this.recomputeDeployable(doc);
    await doc.save();

    await this.auditLogModel.create({
      eventType: 'project.deployment.upserted',
      projectId: id,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: { targetKey: input.targetKey, enabled: input.enabled, deployRef },
    });

    return doc;
  }

  async removeDeploymentTarget(
    id: string,
    targetKey: string,
    teardownK8s = true,
  ): Promise<ProjectDocument> {
    const doc = await this.findProject({ id });
    assertValidTargetKey(targetKey);

    const targets = ensureDeploymentTargets(doc, this.appsDomain);
    const target = targets.find((t) => t.key === targetKey);
    if (!target) {
      throw new NotFoundException(`Deployment target "${targetKey}" not found`);
    }

    if (teardownK8s) {
      await this.k8sService.teardownRelease(
        target.clusterProfile,
        target.kubeNamespace,
        doc.helmReleaseName,
      );
    }

    const scope = target.gitlabEnvironment ?? target.key;
    for (const key of ENV_SCOPED_DEPLOY_VAR_KEYS) {
      await this.gitlabService.deleteProjectCiVariable(doc.gitlabProjectId, key, scope);
    }
    await this.gitlabService.setProjectCiVariable(
      doc.gitlabProjectId,
      buildDeployRefVariable({ ...target, deployRef: DEPLOY_REF_DISABLED }).key,
      DEPLOY_REF_DISABLED,
      '*',
      false,
    );

    doc.deploymentTargets = targets.filter((t) => t.key !== targetKey);
    await this.regenerateDeployCiFiles(doc);
    this.recomputeDeployable(doc);
    await doc.save();

    await this.auditLogModel.create({
      eventType: 'project.deployment.removed',
      projectId: id,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: { targetKey },
    });

    return doc;
  }

  async setDeploymentTargetHostname(
    id: string,
    targetKey: string,
    hostname: string,
  ): Promise<ProjectDocument> {
    return this.setHostnameOverride(id, targetKey, hostname);
  }

  // ---------------------------------------------------------------------------
  // Reconciliation (4.10)
  // ---------------------------------------------------------------------------

  /**
   * Scans all GitLab projects and backfills those without a MongoDB record as
   * `legacyV1: true`. Called once at startup in the background.
   *
   * Projects belonging to the template or config groups are excluded.
   */
  async reconcileLegacyProjects(): Promise<void> {
    this.logger.log('Starting legacy project reconciliation');

    let allProjects: Awaited<ReturnType<typeof this.gitlabService.listProjects>>;
    try {
      allProjects = await this.gitlabService.listProjectsForReconciliation();
    } catch (err) {
      this.logger.warn(
        `Reconciliation: failed to list GitLab projects — ${(err as Error).message}`,
      );
      return;
    }

    const templateGroupId = this.configService.get<number>('gitlab.templateGroupId', {
      infer: true,
    });
    const configGroupId = this.configService.get<number>('gitlab.configGroupId', { infer: true });

    let backfilled = 0;

    for (const glProject of allProjects) {
      // Skip platform meta-groups (templates, configs) by stable group ID, not fragile path prefix.
      // Falling back to path-prefix check when namespace is absent handles very old GitLab versions.
      const namespaceId = glProject.namespace?.id;
      if (namespaceId !== undefined) {
        if (namespaceId === templateGroupId || namespaceId === configGroupId) {
          this.logger.verbose(
            `Reconciliation: skipping platform project "${glProject.path_with_namespace}" (group ${namespaceId})`,
          );
          continue;
        }
      } else if (
        glProject.path_with_namespace.startsWith('templates/') ||
        glProject.path_with_namespace.startsWith('configs/')
      ) {
        this.logger.verbose(
          `Reconciliation: skipping platform project "${glProject.path_with_namespace}" (path-prefix fallback — namespace missing)`,
        );
        continue;
      }

      if (isGitLabProjectPendingDeletion(glProject)) {
        const existing = await this.projectModel.findOne({ gitlabProjectId: glProject.id }).exec();
        if (existing) {
          await this.syncArchivedForGitLabScheduledDeletion(existing, glProject.path_with_namespace);
        } else {
          this.logger.verbose(
            `Reconciliation: skipping GitLab project pending deletion "${glProject.path_with_namespace}"`,
          );
        }
        continue;
      }

      const existing = await this.projectModel.findOne({ gitlabProjectId: glProject.id }).exec();

      if (existing) {
        this.logger.verbose(
          `Reconciliation: project "${glProject.path_with_namespace}" already in registry`,
        );
        continue;
      }

      this.logger.log(
        `Reconciliation: backfilling legacy project "${glProject.path_with_namespace}" (id=${glProject.id})`,
      );

      const parts = glProject.path_with_namespace.split('/');
      const projectSlug = parts.at(-1)!;
      const groupPath = parts.slice(0, -1);
      const vaultBasePath = `projects/${glProject.path_with_namespace}`;
      const effectiveSlug = projectSlug;

      // Use a simple slug — if there's a collision we suffix with gitlab id
      const finalSlug = (await this.slugService.isAvailable(effectiveSlug))
        ? effectiveSlug
        : `${effectiveSlug}-${String(glProject.id)}`;

      const doc = await this.projectModel.create({
        gitlabProjectId: glProject.id,
        gitlabPath: glProject.path_with_namespace,
        groupPath,
        projectSlug,
        effectiveSlug: finalSlug,
        displayName: glProject.name,
        provisioning: 'template' as const,
        vaultBasePath,
        helmReleaseName: finalSlug,
        appHosts: {},
        hostnameOverrides: {},
        capabilities: { deployable: false, publishable: false },
        legacyV1: true,
        pinnedV1: false,
      });

      await this.auditLogModel.create({
        eventType: 'project.reconciled_legacy',
        projectId: String(doc._id),
        gitlabPath: glProject.path_with_namespace,
        effectiveSlug: finalSlug,
        metadata: { reason: 'startup reconciliation', gitlabProjectId: glProject.id },
      });

      // Seed per-env Vault paths so any future deployable upgrade for this
      // legacy project finds ExternalSecret paths already populated.
      // Idempotent — vault KV v2 overwrites are safe.
      for (const env of DEPLOY_ENVS) {
        const envPath = `${vaultBasePath}/${env}`;
        const envData: Record<string, string> = {
          DEPLOY_ENV: env,
          VAULT_PROJECT_PATH: vaultBasePath,
        };
        await this.vaultService.writeSecrets(envPath, envData).catch((err: Error) => {
          this.logger.warn(
            `Reconciliation: could not seed Vault path "${envPath}": ${err.message}`,
          );
        });
        this.logger.verbose(`Reconciliation: seeded Vault path "${envPath}"`);
      }

      backfilled++;
    }

    const archivedFromRegistry = await this.archiveActiveProjectsPendingGitLabDeletion();

    this.logger.log(
      backfilled > 0 || archivedFromRegistry > 0
        ? `Reconciliation complete: ${backfilled} legacy project(s) backfilled, ` +
            `${archivedFromRegistry} active registry row(s) archived (GitLab pending deletion)`
        : 'Reconciliation complete: no new legacy projects found',
    );
  }

  /**
   * Archives platform rows that are still "active" but GitLab has marked the project
   * for deletion (including when the path was not renamed to *-deletion_scheduled-*).
   */
  private async archiveActiveProjectsPendingGitLabDeletion(): Promise<number> {
    const activeDocs = await this.projectModel
      .find({ archived: { $in: [false, null] } })
      .exec();

    let archived = 0;

    for (const doc of activeDocs) {
      let glProject;
      try {
        glProject = await this.gitlabService.getProject(doc.gitlabProjectId);
      } catch {
        continue;
      }

      if (!isGitLabProjectPendingDeletion(glProject)) {
        continue;
      }

      await this.syncArchivedForGitLabScheduledDeletion(doc, glProject.path_with_namespace);
      archived++;
    }

    return archived;
  }

  /**
   * Marks an existing registry row archived when GitLab renamed the project for scheduled deletion.
   * Updates gitlabPath to the current GitLab namespace so the Archived tab reflects reality.
   */
  private async syncArchivedForGitLabScheduledDeletion(
    doc: ProjectDocument,
    gitlabPath: string,
  ): Promise<void> {
    const parts = gitlabPath.split('/');
    const projectSlug = parts.at(-1)!;
    const groupPath = parts.slice(0, -1);

    doc.archived = true;
    doc.archivedAt = doc.archivedAt ?? new Date();
    doc.archiveReason = 'gitlab_scheduled_for_deletion';
    doc.gitlabDeleteError =
      doc.gitlabDeleteError ??
      'GitLab project is scheduled for deletion (pending instance retention)';
    doc.gitlabPath = gitlabPath;
    doc.groupPath = groupPath;
    doc.projectSlug = projectSlug;
    await doc.save();

    this.logger.log(
      `Reconciliation: archived pending-deletion project "${gitlabPath}" (mongo id=${String(doc._id)})`,
    );
  }
}
