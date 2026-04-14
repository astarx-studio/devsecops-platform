import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { GitLabService } from '../gitlab/gitlab.service';
import { ConfigInfoDto, CreateConfigDto, UpdateConfigFilesDto } from './dto';

/**
 * Manages shared CI/CD config repositories in the GitLab "configs" group.
 *
 * Config repos contain reusable hidden CI job definitions (`.lint`, `.build`, etc.)
 * that app projects reference via GitLab CI `include: project:` directives.
 */
@Injectable()
export class ConfigsService {
  private readonly logger = new Logger(ConfigsService.name);

  constructor(private readonly gitlabService: GitLabService) {}

  /**
   * Lists all config repos in the configs group.
   *
   * @returns Array of config info objects
   */
  async listConfigs(): Promise<ConfigInfoDto[]> {
    this.logger.log('Listing all config repos');
    const projects = await this.gitlabService.listProjects(this.gitlabService.configGroup);

    return projects.map((p) => ({
      id: p.id,
      slug: p.name,
      description: p.description,
      gitlabUrl: p.web_url,
      lastActivityAt: p.last_activity_at,
    }));
  }

  /**
   * Gets detailed info for a specific config repo, including its file tree.
   *
   * @param slug - Config repo slug (project name)
   * @returns Config info with file tree, or throws NotFoundException
   */
  async getConfig(slug: string): Promise<ConfigInfoDto> {
    this.logger.log(`Getting config detail for "${slug}"`);
    const project = await this.gitlabService.findProjectInGroupPublic(
      this.gitlabService.configGroup,
      slug,
    );

    if (!project) {
      throw new NotFoundException(`Config "${slug}" not found`);
    }

    const files = await this.gitlabService.getProjectTree(
      project.id,
      undefined,
      project.default_branch ?? 'main',
      true,
    );

    return {
      id: project.id,
      slug: project.name,
      description: project.description,
      gitlabUrl: project.web_url,
      lastActivityAt: project.last_activity_at,
      files,
    };
  }

  /**
   * Creates a new config repo with an initial `.gitlab-ci.yml`.
   *
   * @param dto - Config creation parameters (slug, description, ciContent)
   * @returns The newly created config info
   */
  async createConfig(dto: CreateConfigDto): Promise<ConfigInfoDto> {
    this.logger.log(`Creating config repo "${dto.slug}"`);

    const existing = await this.gitlabService.findProjectInGroupPublic(
      this.gitlabService.configGroup,
      dto.slug,
    );
    if (existing) {
      throw new ConflictException(`Config "${dto.slug}" already exists (id=${existing.id})`);
    }

    const project = await this.gitlabService.createNewProject(
      this.gitlabService.configGroup,
      dto.slug,
      dto.description,
      true,
    );

    this.logger.log(
      `Config repo created: "${project.path_with_namespace}" (id=${project.id}). Writing .gitlab-ci.yml...`,
    );

    await this.gitlabService.upsertFile(
      project.id,
      '.gitlab-ci.yml',
      dto.ciContent,
      'chore: initialize shared CI config',
    );

    return {
      id: project.id,
      slug: project.name,
      description: project.description,
      gitlabUrl: project.web_url,
      lastActivityAt: project.last_activity_at,
    };
  }

  /**
   * Updates files in a config repo.
   *
   * @param slug - Config repo slug
   * @param dto - File path, content, and commit message
   */
  async updateConfigFiles(slug: string, dto: UpdateConfigFilesDto): Promise<void> {
    this.logger.log(`Updating file "${dto.filePath}" in config "${slug}"`);

    const project = await this.gitlabService.findProjectInGroupPublic(
      this.gitlabService.configGroup,
      slug,
    );
    if (!project) {
      throw new NotFoundException(`Config "${slug}" not found`);
    }

    await this.gitlabService.upsertFile(project.id, dto.filePath, dto.content, dto.commitMessage);

    this.logger.log(`File "${dto.filePath}" updated in config "${slug}" (project ${project.id})`);
  }

  /**
   * Deletes a config repo from GitLab.
   *
   * @param slug - Config repo slug to delete
   */
  async deleteConfig(slug: string): Promise<void> {
    this.logger.warn(`Deleting config repo "${slug}"`);

    const project = await this.gitlabService.findProjectInGroupPublic(
      this.gitlabService.configGroup,
      slug,
    );
    if (!project) {
      throw new NotFoundException(`Config "${slug}" not found`);
    }

    await this.gitlabService.deleteProject(project.id);
    this.logger.log(`Config repo "${slug}" (id=${project.id}) deleted`);
  }
}
