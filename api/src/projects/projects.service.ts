import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as yaml from 'js-yaml';

import { AppConfiguration } from '../config';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { GitLabService } from '../gitlab/gitlab.service';
import { KongService } from '../kong/kong.service';
import { VaultService } from '../vault/vault.service';
import { CreateProjectDto, ProjectInfoDto } from './dto';

interface CiYaml {
  include?: Array<{ project: string; file: string }>;
  [key: string]: unknown;
}

/**
 * Orchestrates project provisioning across GitLab, Vault, Kong, and Cloudflare.
 *
 * Supports compositional capabilities:
 *   - deployable: subdomain, Kong route, optional Cloudflare DNS, deploy pipeline
 *   - publishable: package name, publish pipeline
 *   - both or neither
 *
 * The create flow:
 *   1. Validate inputs
 *   2. Create GitLab group hierarchy
 *   3. Fork template repository
 *   4. Inject CI config includes (if configs specified)
 *   5. Create Vault secrets
 *   6. Register Kong service + route (if deployable)
 *   7. Configure Cloudflare DNS (if deployable, optional, non-critical)
 *   8. Trigger CI pipeline (if deployable + autoDeploy, optional, non-critical)
 *
 * Delete reverses the process, with non-critical steps continuing on failure.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly appsDomain: string;
  private readonly gitlabExternalUrl: string;

  constructor(
    private readonly gitlabService: GitLabService,
    private readonly kongService: KongService,
    private readonly vaultService: VaultService,
    private readonly cloudflareService: CloudflareService,
    private readonly configService: ConfigService<AppConfiguration>,
  ) {
    this.appsDomain = this.configService.get<string>('appsDomain', {
      infer: true,
    })!;
    this.gitlabExternalUrl = `https://${this.configService.get<string>('gitlabDomain', { infer: true })!}`;
  }

  async createProject(dto: CreateProjectDto): Promise<ProjectInfoDto> {
    const { clientName, projectName, templateSlug, capabilities } = dto;
    const groupPath = dto.groupPath ?? ['clients', clientName];
    const vaultPath = `projects/${clientName}/${projectName}`;

    const isDeployable = !!capabilities?.deployable;
    const isPublishable = !!capabilities?.publishable;

    this.logger.log(
      `Creating project: client="${clientName}" project="${projectName}" ` +
        `template="${templateSlug}" deployable=${isDeployable} publishable=${isPublishable}`,
    );

    // Step 1: Create GitLab group hierarchy
    this.logger.log(`Step 1: Creating group hierarchy: ${groupPath.join('/')}`);
    const groupId = await this.gitlabService.createGroupHierarchy(groupPath);

    // Step 2: Fork template
    this.logger.log(`Step 2: Forking template "${templateSlug}" into group ${groupId}`);
    const forkedProject = await this.gitlabService.forkTemplate(templateSlug, groupId, projectName);

    // Step 3: Inject CI config includes
    const injectedConfigs = await this.injectConfigIncludes(forkedProject.id, dto.configs);

    // Step 4: Seed Vault secrets
    this.logger.log(`Step 4: Seeding Vault secrets at "${vaultPath}"`);
    const secrets: Record<string, string> = {
      PROJECT_NAME: projectName,
      CLIENT_NAME: clientName,
      GITLAB_PROJECT_ID: String(forkedProject.id),
      DEPLOYMENT_ENV: 'local',
      ...dto.envVars,
    };
    await this.vaultService.writeSecrets(vaultPath, secrets);

    const result: ProjectInfoDto = {
      id: forkedProject.id,
      name: projectName,
      clientName,
      gitlabUrl: forkedProject.web_url,
      vaultPath,
      configs: injectedConfigs.length > 0 ? injectedConfigs : undefined,
    };

    // Step 5: Deployable capability — Kong route + optional DNS
    if (isDeployable) {
      const hostname = capabilities.deployable!.domain ?? `${projectName}.${this.appsDomain}`;
      const kongServiceName = `${clientName}-${projectName}-service`;

      this.logger.log(`Step 5a: Registering Kong service "${kongServiceName}" for ${hostname}`);
      const upstreamUrl = this.resolveUpstreamUrl(clientName, projectName);
      await this.kongService.registerService(kongServiceName, upstreamUrl, [hostname]);

      result.appUrl = hostname;
      result.kongServiceName = kongServiceName;

      // Cloudflare DNS (optional, non-critical)
      try {
        this.logger.log(`Step 5b: Configuring Cloudflare DNS for ${hostname}`);
        result.cloudflareConfigured = await this.cloudflareService.addDnsRecord(hostname);
      } catch (error) {
        this.logger.warn(`Cloudflare DNS setup failed (non-critical): ${(error as Error).message}`);
        result.cloudflareConfigured = false;
      }

      // Trigger CI pipeline (optional, non-critical)
      const autoDeploy = capabilities.deployable!.autoDeploy ?? true;
      if (autoDeploy) {
        try {
          this.logger.log(`Step 5c: Triggering initial pipeline for project ${forkedProject.id}`);
          await this.gitlabService.triggerPipeline(forkedProject.id);
        } catch (error) {
          this.logger.warn(`Pipeline trigger failed (non-critical): ${(error as Error).message}`);
        }
      }
    }

    // Step 6: Publishable capability — package name
    if (isPublishable) {
      const packageName = capabilities.publishable!.packageName ?? `@${clientName}/${projectName}`;

      this.logger.log(`Step 6: Publishable package name: ${packageName}`);

      result.packageName = packageName;
      result.registryUrl = `${this.gitlabExternalUrl}/${groupPath.join('/')}/${projectName}/-/packages`;
    }

    this.logger.log(`Project "${clientName}/${projectName}" created successfully`);

    return result;
  }

  async listProjects(): Promise<ProjectInfoDto[]> {
    const projects = await this.gitlabService.listProjects();
    return projects.map((p) => {
      const parts = p.path_with_namespace.split('/');
      const projectName = parts.at(-1)!;
      const clientName = parts.length >= 3 ? parts.at(-2)! : 'unknown';

      return {
        id: p.id,
        name: projectName,
        clientName,
        gitlabUrl: p.web_url,
        vaultPath: `projects/${clientName}/${projectName}`,
      };
    });
  }

  async getProject(projectId: number): Promise<ProjectInfoDto> {
    const project = await this.gitlabService.getProject(projectId);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const parts = project.path_with_namespace.split('/');
    const projectName = parts.at(-1)!;
    const clientName = parts.length >= 3 ? parts.at(-2)! : 'unknown';

    return {
      id: project.id,
      name: projectName,
      clientName,
      gitlabUrl: project.web_url,
      vaultPath: `projects/${clientName}/${projectName}`,
    };
  }

  async deleteProject(projectId: number): Promise<void> {
    this.logger.log(`Deleting project ${projectId} and all associated resources`);

    const project = await this.gitlabService.getProject(projectId);
    const parts = project.path_with_namespace.split('/');
    const projectName = parts.at(-1);
    const clientName = parts.length >= 3 ? parts.at(-2) : 'unknown';
    const hostname = `${projectName}.${this.appsDomain}`;
    const kongServiceName = `${clientName}-${projectName}-service`;
    const vaultPath = `projects/${clientName}/${projectName}`;

    // Remove Kong routes (non-critical, may not exist if project wasn't deployable)
    try {
      this.logger.log(`Removing Kong service "${kongServiceName}"`);
      await this.kongService.removeService(kongServiceName);
    } catch (error) {
      this.logger.warn(`Kong cleanup failed (non-critical): ${(error as Error).message}`);
    }

    // Remove Cloudflare DNS (non-critical)
    try {
      this.logger.log(`Removing Cloudflare DNS for ${hostname}`);
      await this.cloudflareService.removeDnsRecord(hostname);
    } catch (error) {
      this.logger.warn(`Cloudflare cleanup failed (non-critical): ${(error as Error).message}`);
    }

    // Remove Vault secrets (non-critical)
    try {
      this.logger.log(`Removing Vault secrets at "${vaultPath}"`);
      await this.vaultService.deleteSecrets(vaultPath);
    } catch (error) {
      this.logger.warn(`Vault cleanup failed (non-critical): ${(error as Error).message}`);
    }

    // Delete GitLab project (critical)
    this.logger.log(`Deleting GitLab project ${projectId}`);
    await this.gitlabService.deleteProject(projectId);

    this.logger.log(`Project ${projectId} deleted successfully`);
  }

  /**
   * Injects CI config `include:` directives into a project's `.gitlab-ci.yml`.
   *
   * Reads the existing CI file, merges new include entries (deduplicating),
   * and commits the updated file back to the repository.
   *
   * @param projectId - GitLab project ID of the forked project
   * @param configSlugs - Array of config repo slugs to include
   * @returns Array of config slugs that were actually injected
   */
  private async injectConfigIncludes(projectId: number, configSlugs?: string[]): Promise<string[]> {
    if (!configSlugs || configSlugs.length === 0) {
      this.logger.debug('No config includes to inject, skipping');
      return [];
    }

    this.logger.log(
      `Step 3: Injecting ${configSlugs.length} config include(s) into project ${projectId}`,
    );

    const rawContent = await this.gitlabService.getFileContent(projectId, '.gitlab-ci.yml');

    let ciConfig: CiYaml;
    if (rawContent) {
      ciConfig = (yaml.load(rawContent) as CiYaml) ?? { include: [] };
    } else {
      this.logger.debug('No existing .gitlab-ci.yml found, creating from scratch');
      ciConfig = { include: [] };
    }

    const existingIncludes: Array<{ project: string; file: string }> = Array.isArray(
      ciConfig.include,
    )
      ? ciConfig.include
      : [];

    const existingKeys = new Set(existingIncludes.map((inc) => `${inc.project}::${inc.file}`));

    const newIncludes: Array<{ project: string; file: string }> = [];
    for (const slug of configSlugs) {
      const entry = { project: `configs/${slug}`, file: '/.gitlab-ci.yml' };
      const key = `${entry.project}::${entry.file}`;
      if (existingKeys.has(key)) {
        this.logger.debug(`Include already present: project="${entry.project}", skipping`);
      } else {
        newIncludes.push(entry);
        existingKeys.add(key);
        this.logger.debug(`Adding include: project="${entry.project}"`);
      }
    }

    if (newIncludes.length === 0) {
      this.logger.debug('All requested configs already included');
      return configSlugs;
    }

    ciConfig.include = [...existingIncludes, ...newIncludes];

    const updatedContent = yaml.dump(ciConfig, {
      lineWidth: 120,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });

    await this.gitlabService.upsertFile(
      projectId,
      '.gitlab-ci.yml',
      updatedContent,
      `chore: inject config includes [${configSlugs.join(', ')}]`,
    );

    this.logger.log(`Injected ${newIncludes.length} new include(s) into .gitlab-ci.yml`);

    return configSlugs;
  }

  /**
   * Resolves the upstream URL for a local deployment.
   * The container is expected to be reachable on the devops-network
   * under the name "{clientName}-{projectName}" on port 3000.
   */
  private resolveUpstreamUrl(clientName: string, projectName: string): string {
    return `http://${clientName}-${projectName}:3000`;
  }
}
