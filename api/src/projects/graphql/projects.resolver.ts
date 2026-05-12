import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';

import { CombinedAuthGuard } from '../../common/guards';
import { ConfigsService } from '../../configs/configs.service';
import { TemplatesService } from '../../templates/templates.service';
import { SlugService } from '../slug.service';
import { ProjectsService } from '../projects.service';
import { Env } from './enums';
import { CreateProjectInput, ProjectFilterInput } from './project.inputs';
import { ConfigType, ProjectType, TemplateType } from './project.type';

import type { ProjectDocument } from '../schemas/project.schema';

/**
 * Maps a Mongoose ProjectDocument to the GraphQL ProjectType.
 * Handles the `id` ← `_id` conversion and enum coercion.
 */
function mapProject(doc: ProjectDocument): ProjectType {
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
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly slugService: SlugService,
    private readonly templatesService: TemplatesService,
    private readonly configsService: ConfigsService,
  ) {}

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
    return docs.map(mapProject);
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
      return mapProject(doc);
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
    return mapProject(doc);
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
    return mapProject(doc);
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
    return mapProject(doc);
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
    return mapProject(doc);
  }
}
