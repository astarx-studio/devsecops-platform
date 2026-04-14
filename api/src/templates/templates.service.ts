import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { GitLabService } from '../gitlab/gitlab.service';
import { CreateTemplateDto, TemplateInfoDto } from './dto';

/**
 * Manages template repositories in the GitLab "templates" group.
 *
 * Templates are starter projects that are forked when creating new apps.
 * They contain sensible defaults for CI/CD (via config includes), Dockerfile,
 * docker-compose, and application scaffolding.
 */
@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(private readonly gitlabService: GitLabService) {}

  /**
   * Lists all template repos in the templates group.
   *
   * @returns Array of template info objects
   */
  async listTemplates(): Promise<TemplateInfoDto[]> {
    this.logger.log('Listing all template repos');
    const projects = await this.gitlabService.listProjects(this.gitlabService.templateGroup);

    return projects.map((p) => ({
      id: p.id,
      slug: p.name,
      description: p.description,
      gitlabUrl: p.web_url,
      defaultBranch: p.default_branch,
      lastActivityAt: p.last_activity_at,
    }));
  }

  /**
   * Gets detailed info for a specific template, including its file tree.
   *
   * @param slug - Template slug (project name)
   * @returns Template info with file tree, or throws NotFoundException
   */
  async getTemplate(slug: string): Promise<TemplateInfoDto> {
    this.logger.log(`Getting template detail for "${slug}"`);
    const project = await this.gitlabService.findProjectInGroupPublic(
      this.gitlabService.templateGroup,
      slug,
    );

    if (!project) {
      throw new NotFoundException(`Template "${slug}" not found`);
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
      defaultBranch: project.default_branch,
      lastActivityAt: project.last_activity_at,
      files,
    };
  }

  /**
   * Creates a new template repo, optionally populated with initial files.
   *
   * The repo is created with a README and then each file from `dto.files`
   * is committed sequentially. For large file sets, consider pushing via Git.
   *
   * @param dto - Template creation parameters
   * @returns The newly created template info
   */
  async createTemplate(dto: CreateTemplateDto): Promise<TemplateInfoDto> {
    this.logger.log(`Creating template repo "${dto.slug}"`);

    const existing = await this.gitlabService.findProjectInGroupPublic(
      this.gitlabService.templateGroup,
      dto.slug,
    );
    if (existing) {
      throw new ConflictException(`Template "${dto.slug}" already exists (id=${existing.id})`);
    }

    const project = await this.gitlabService.createNewProject(
      this.gitlabService.templateGroup,
      dto.slug,
      dto.description,
      true,
    );

    this.logger.log(`Template repo created: "${project.path_with_namespace}" (id=${project.id})`);

    if (dto.files) {
      const entries = Object.entries(dto.files);
      this.logger.log(`Populating template with ${entries.length} file(s)`);

      for (const [filePath, content] of entries) {
        this.logger.debug(`Writing file: ${filePath}`);
        await this.gitlabService.upsertFile(
          project.id,
          filePath,
          content,
          `chore: add ${filePath}`,
        );
      }
    }

    return {
      id: project.id,
      slug: project.name,
      description: project.description,
      gitlabUrl: project.web_url,
      defaultBranch: project.default_branch,
      lastActivityAt: project.last_activity_at,
    };
  }

  /**
   * Deletes a template repo from GitLab.
   *
   * @param slug - Template slug to delete
   */
  async deleteTemplate(slug: string): Promise<void> {
    this.logger.warn(`Deleting template repo "${slug}"`);

    const project = await this.gitlabService.findProjectInGroupPublic(
      this.gitlabService.templateGroup,
      slug,
    );
    if (!project) {
      throw new NotFoundException(`Template "${slug}" not found`);
    }

    await this.gitlabService.deleteProject(project.id);
    this.logger.log(`Template repo "${slug}" (id=${project.id}) deleted`);
  }
}
