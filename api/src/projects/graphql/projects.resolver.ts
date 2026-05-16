import { UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';

import { AppConfiguration } from '../../config';

import { CombinedAuthGuard } from '../../common/guards';
import { ConfigsService } from '../../configs/configs.service';
import { TemplatesService } from '../../templates/templates.service';
import { SlugService } from '../slug.service';
import { ProjectsService } from '../projects.service';
import { Env } from './enums';
import { CreateProjectInput, ProjectFilterInput, UpdateProjectSonarConfigInput } from './project.inputs';
import { ConfigType, ProjectSonarType, ProjectType, SonarGatePolicyType, TemplateType } from './project.type';
import { isSonarEnabled, resolveSonarGatePolicy } from '../sonar/sonar.types';

import type { ProjectDocument } from '../schemas/project.schema';

function mapSonar(doc: ProjectDocument, dashboardBaseUrl?: string): ProjectSonarType | undefined {
  if (!isSonarEnabled(doc.sonar)) {
    return undefined;
  }
  const gatePolicy = resolveSonarGatePolicy(doc.sonar?.gatePolicy);
  const firstBranch = doc.sonar!.allowedBranches[0];
  const dashboardUrl =
    dashboardBaseUrl && firstBranch
      ? `${dashboardBaseUrl}/dashboard?id=${encodeURIComponent(`${doc.effectiveSlug}_${firstBranch.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`)}`
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
function mapProject(doc: ProjectDocument, sonarPublicUrl?: string): ProjectType {
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
    appHosts: {
      dev: doc.appHosts?.dev,
      stg: doc.appHosts?.stg,
      prod: doc.appHosts?.prod,
    },
    capabilities: {
      deployable: doc.capabilities?.deployable ?? false,
      publishable: doc.capabilities?.publishable ?? false,
    },
    sonar: mapSonar(doc, sonarPublicUrl),
    legacyV1: doc.legacyV1,
    pinnedV1: doc.pinnedV1,
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

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly slugService: SlugService,
    private readonly templatesService: TemplatesService,
    private readonly configsService: ConfigsService,
    configService: ConfigService<AppConfiguration>,
  ) {
    this.sonarPublicUrl = configService.get<string>('sonarqube.publicUrl', { infer: true })!;
  }

  private mapDoc(doc: ProjectDocument): ProjectType {
    return mapProject(doc, this.sonarPublicUrl);
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

  @Mutation(() => Boolean, {
    description:
      'Deletes a project: removes the GitLab project, Vault secrets, and MongoDB record.',
  })
  async deleteProject(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.projectsService.deleteProject(id);
  }

  @Mutation(() => ProjectType, {
    description:
      'Migrates a legacy v1 project to the Auto DevOps pipeline. ' +
      'Writes .gitlab-ci.yml, sets CI vars, and triggers the pipeline. ' +
      'Compose-side cleanup for fully migrated projects is handled separately after prod is stable.',
  })
  async migrateProjectToAutoDevops(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ProjectType> {
    const doc = await this.projectsService.migrateProjectToAutoDevops(id);
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
      'Overrides the application hostname for a specific environment. ' +
      'Updates MongoDB, hostnameOverrides, appHosts, and the APP_HOST CI variable.',
  })
  async setHostnameOverride(
    @Args('id', { type: () => ID }) id: string,
    @Args('env', { type: () => Env }) env: Env,
    @Args('hostname') hostname: string,
  ): Promise<ProjectType> {
    const doc = await this.projectsService.setHostnameOverride(id, env, hostname);
    return this.mapDoc(doc);
  }
}
