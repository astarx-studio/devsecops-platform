import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';

import type { QueryFilter, Model } from 'mongoose';

import { AppConfiguration } from '../config';
import { GitLabService } from '../gitlab/gitlab.service';
import { K8sService } from '../k8s/k8s.service';
import { VaultService } from '../vault/vault.service';
import { CreateProjectInput, ProjectFilterInput } from './graphql/project.inputs';
import { Provisioning } from './graphql/enums';
import { AuditLog } from './schemas/audit-log.schema';
import { Project, ProjectDocument } from './schemas/project.schema';
import { SlugService } from './slug.service';

import type { DeployEnv } from './schemas/project.schema';

/** Environments provisioned for every project. */
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
  private buildAutoDevopsCi(): string {
    const project = this.configService.get<string>('autoDevops.pipelineProject', { infer: true })!;
    const file = this.configService.get<string>('autoDevops.pipelineFile', { infer: true })!;
    this.logger.verbose(`buildAutoDevopsCi: project="${project}" file="${file}"`);
    return `include:\n  - project: ${project}\n    file: ${file}\n`;
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
      // Projects whose groupPath starts with the provided prefix
      const prefix = filter.groupPathPrefix;
      query['groupPath'] = {
        $all: prefix.map((seg, i) => ({ $elemMatch: { $eq: seg, $position: i } })),
      };
      // Simpler approach: check first N elements match
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
    const effectiveSlug = await this.slugService.resolve(
      projectSlug,
      groupPath,
      slugOverride,
    );
    this.logger.log(`Effective slug resolved: "${effectiveSlug}"`);

    const gitlabPath = [...groupPath, projectSlug].join('/');
    const vaultBasePath = `projects/${[...groupPath, projectSlug].join('/')}`;
    const helmReleaseName = effectiveSlug;

    // Compute app hostnames
    const appHosts = this.buildAppHosts(effectiveSlug);

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
      this.logger.log(`Step 3: Creating new Auto DevOps project "${projectSlug}" in group ${groupId}`);
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
        this.buildAutoDevopsCi(),
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

    // Step 4b: Per-env Vault writes when envScopedVars is provided
    const envScopedEnvsWritten: DeployEnv[] = [];
    if (input.envScopedVars) {
      for (const env of DEPLOY_ENVS) {
        const raw = input.envScopedVars[env];
        if (!raw) continue;

        const envPath = `${vaultBasePath}/${env}`;
        try {
          const parsed = JSON.parse(raw) as Record<string, string>;
          await this.vaultService.writeSecrets(envPath, parsed);
          envScopedEnvsWritten.push(env);
          this.logger.log(`Step 4b: Seeded env-scoped Vault secrets at "${envPath}"`);
        } catch (err) {
          this.logger.warn(
            `envScopedVars.${env} is not valid JSON — skipping: ${(err as Error).message}`,
          );
        }
      }
    }

    // Step 5: Ensure k3d namespaces exist
    this.logger.log('Step 5: Ensuring k3d namespaces exist');
    await Promise.all(DEPLOY_ENVS.map((env) => this.k8sService.ensureNamespace(env)));

    // Step 6: Set env-scoped CI variables on the GitLab project
    if (isDeployable) {
      this.logger.log('Step 6: Setting env-scoped CI variables on GitLab project');
      const ciVariables: Array<{ key: string; value: string; environmentScope: string; masked?: boolean }> = [];

      for (const env of DEPLOY_ENVS) {
        ciVariables.push({ key: 'KUBE_NAMESPACE', value: env, environmentScope: env });
        ciVariables.push({
          key: 'APP_HOST',
          value: appHosts[env] ?? `${effectiveSlug}.${env}.${this.appsDomain}`,
          environmentScope: env,
        });
        ciVariables.push({
          key: 'VAULT_PROJECT_PATH',
          value: vaultBasePath,
          environmentScope: env,
        });

        // KUBECONFIG_B64: set per-project so CI jobs can connect to the right cluster env.
        // The bootstrap runner-rbac.sh generates these kubeconfig files.
        const kubeconfigB64 = this.k8sService.getKubeconfigB64(env);
        if (kubeconfigB64) {
          ciVariables.push({
            key: 'KUBECONFIG_B64',
            value: kubeconfigB64,
            environmentScope: env,
          });
        } else {
          this.logger.warn(
            `KUBECONFIG_B64 not set for env="${env}" — kubeconfig file missing. ` +
              'Run bootstrap/runner-rbac.sh to generate kubeconfigs.',
          );
        }
      }

      await this.gitlabService.setProjectCiVariables(gitlabProjectId, ciVariables);
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
      appHosts: {
        dev: appHosts['dev'],
        stg: appHosts['stg'],
        prod: appHosts['prod'],
      },
      // hostnameOverrides always starts empty at create time;
      // per-env hostname overrides are set via the setHostnameOverride mutation.
      hostnameOverrides: {},
      capabilities: { deployable: isDeployable, publishable: isPublishable },
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

    this.logger.log(
      `Project "${gitlabPath}" provisioned successfully (id=${String(doc._id)}, slug="${effectiveSlug}")`,
    );
    return doc;
  }

  /**
   * Deletes a project and all associated resources.
   *
   * @param id - MongoDB document ID
   * @returns true on success
   */
  async deleteProject(id: string): Promise<boolean> {
    this.logger.log(`deleteProject: id=${id}`);
    const doc = await this.findProject({ id });

    // Delete GitLab project (critical)
    this.logger.log(`Deleting GitLab project ${doc.gitlabProjectId}`);
    await this.gitlabService.deleteProject(doc.gitlabProjectId);

    // Delete Vault secrets (non-critical)
    try {
      this.logger.log(`Deleting Vault secrets at "${doc.vaultBasePath}"`);
      await this.vaultService.deleteSecrets(doc.vaultBasePath);
    } catch (err) {
      this.logger.warn(`Vault cleanup failed (non-critical): ${(err as Error).message}`);
    }

    // Audit log
    await this.auditLogModel.create({
      eventType: 'project.deleted',
      projectId: id,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: {},
    });

    // Remove MongoDB document
    await doc.deleteOne();

    this.logger.log(`Project "${doc.gitlabPath}" deleted successfully`);
    return true;
  }

  /**
   * Migrates a legacy v1 project to the Auto DevOps pipeline:
   *  1. Writes `.gitlab-ci.yml` with Auto DevOps include
   *  2. Sets env-scoped CI variables
   *  3. Triggers the pipeline
   *  4. Sets `legacyV1 = false` in MongoDB
   *
   * Note: the full v1 cleanup (remove Kong route, stop compose stack) is a
   * Phase 5 operation that runs after a successful prod deploy.
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
    await this.gitlabService.upsertFile(
      doc.gitlabProjectId,
      '.gitlab-ci.yml',
      this.buildAutoDevopsCi(),
      'chore: migrate to Auto DevOps pipeline',
    );

    if (doc.capabilities.deployable) {
      await this.gitlabService.upsertFile(
        doc.gitlabProjectId,
        'chart-values.yaml',
        ProjectsService.buildChartValues(),
        'chore: add chart-values.yaml for v2 Auto DevOps',
      );
    }

    // Step 2: Set env-scoped CI variables
    if (doc.capabilities.deployable) {
      const ciVars: Array<{ key: string; value: string; environmentScope: string; masked?: boolean }> = [];
      for (const env of DEPLOY_ENVS) {
        ciVars.push({ key: 'KUBE_NAMESPACE', value: env, environmentScope: env });
        ciVars.push({
          key: 'APP_HOST',
          value: doc.appHosts[env as DeployEnv] ?? `${doc.effectiveSlug}.${env}.${this.appsDomain}`,
          environmentScope: env,
        });
        ciVars.push({ key: 'VAULT_PROJECT_PATH', value: doc.vaultBasePath, environmentScope: env });

        const kubeconfigB64 = this.k8sService.getKubeconfigB64(env as DeployEnv);
        if (kubeconfigB64) {
          ciVars.push({ key: 'KUBECONFIG_B64', value: kubeconfigB64, environmentScope: env });
        }
      }
      await this.gitlabService.setProjectCiVariables(doc.gitlabProjectId, ciVars);
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
  async setHostnameOverride(id: string, env: DeployEnv, hostname: string): Promise<ProjectDocument> {
    this.logger.log(`setHostnameOverride: id=${id} env=${env} hostname="${hostname}"`);
    const doc = await this.findProject({ id });

    doc.hostnameOverrides = { ...(doc.hostnameOverrides ?? {}), [env]: hostname };
    doc.appHosts = { ...(doc.appHosts ?? {}), [env]: hostname };
    await doc.save();

    // Update APP_HOST CI var for this env
    try {
      await this.gitlabService.setProjectCiVariable(
        doc.gitlabProjectId,
        'APP_HOST',
        hostname,
        env,
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
      metadata: { env, hostname },
    });

    return doc;
  }

  /**
   * Sets or clears the `pinnedV1` flag on a project.
   *
   * @param id - MongoDB document ID
   * @param pinned - Whether to pin the project on v1 indefinitely
   */
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
      allProjects = await this.gitlabService.listProjects();
    } catch (err) {
      this.logger.warn(
        `Reconciliation: failed to list GitLab projects — ${(err as Error).message}`,
      );
      return;
    }

    const templateGroupId = this.configService.get<number>('gitlab.templateGroupId', { infer: true });
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

      const existing = await this.projectModel
        .findOne({ gitlabProjectId: glProject.id })
        .exec();

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

      backfilled++;
    }

    this.logger.log(
      backfilled > 0
        ? `Reconciliation complete: ${backfilled} legacy project(s) backfilled`
        : 'Reconciliation complete: no new legacy projects found',
    );
  }

}
