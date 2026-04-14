import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import { AppConfiguration } from '../config';

export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  web_url: string;
  description: string | null;
  default_branch: string;
  last_activity_at: string;
}

export interface GitLabGroup {
  id: number;
  name: string;
  path: string;
  full_path: string;
}

export interface GitLabTreeItem {
  id: string;
  name: string;
  type: 'tree' | 'blob';
  path: string;
  mode: string;
}

export interface GitLabFileContent {
  file_name: string;
  file_path: string;
  size: number;
  encoding: string;
  content: string;
  content_sha256: string;
  ref: string;
  last_commit_id: string;
}

/**
 * Client for the GitLab API v4.
 *
 * Manages group hierarchies, template forks, project CRUD, pipeline triggers,
 * repository file operations, and project tree browsing.
 * Uses internal Docker DNS URL (http://gitlab) for API calls.
 */
@Injectable()
export class GitLabService {
  private readonly logger = new Logger(GitLabService.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly templateGroupId: number;
  private readonly configGroupId: number;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService<AppConfiguration>,
  ) {
    this.baseUrl = configService.get<string>('gitlab.url', { infer: true })!;
    this.token = configService.get<string>('gitlab.token', { infer: true })!;
    this.templateGroupId = Number(configService.get('gitlab.templateGroupId', { infer: true }));
    this.configGroupId = Number(configService.get('gitlab.configGroupId', { infer: true }));
  }

  private get headers() {
    return { 'PRIVATE-TOKEN': this.token };
  }

  get templateGroup(): number {
    return this.templateGroupId;
  }

  get configGroup(): number {
    return this.configGroupId;
  }

  /**
   * Recursively creates nested GitLab groups, returning the ID of the deepest group.
   *
   * @param groupPath - Array of group names from root to leaf (e.g. ["clients", "acme"])
   * @returns Numeric ID of the deepest (leaf) group
   */
  async createGroupHierarchy(groupPath: string[]): Promise<number> {
    let parentId: number | undefined;

    for (const segment of groupPath) {
      const existing = await this.findGroup(segment, parentId);
      if (existing) {
        this.logger.debug(`Group "${segment}" already exists (id=${existing.id})`);
        parentId = existing.id;
      } else {
        this.logger.log(`Creating group "${segment}" under parent=${parentId ?? 'root'}`);
        const group = await this.createGroup(segment, parentId);
        parentId = group.id;
      }
    }

    return parentId!;
  }

  /**
   * Forks a template project into the target group.
   *
   * @param templateSlug - Name of the template project in the template group
   * @param targetGroupId - GitLab group ID to fork into
   * @param projectName - Name for the new forked project
   * @returns The forked GitLab project
   */
  async forkTemplate(
    templateSlug: string,
    targetGroupId: number,
    projectName: string,
  ): Promise<GitLabProject> {
    const templateProject = await this.findProjectInGroup(this.templateGroupId, templateSlug);
    if (!templateProject) {
      throw new Error(`Template "${templateSlug}" not found in group ${this.templateGroupId}`);
    }

    this.logger.log(
      `Forking template "${templateSlug}" (id=${templateProject.id}) -> "${projectName}" in group ${targetGroupId}`,
    );

    const { data } = await firstValueFrom(
      this.httpService.post<GitLabProject>(
        `${this.baseUrl}/api/v4/projects/${templateProject.id}/fork`,
        {
          namespace_id: targetGroupId,
          name: projectName,
          path: projectName,
        },
        { headers: this.headers },
      ),
    );

    this.logger.log(`Forked project created: "${data.path_with_namespace}" (id=${data.id})`);
    return data;
  }

  /**
   * Lists all projects, optionally filtered by group.
   *
   * @param groupId - If provided, lists only projects in this group
   * @returns Array of GitLab projects
   */
  async listProjects(groupId?: number): Promise<GitLabProject[]> {
    const url = groupId
      ? `${this.baseUrl}/api/v4/groups/${groupId}/projects`
      : `${this.baseUrl}/api/v4/projects`;

    const { data } = await firstValueFrom(
      this.httpService.get<GitLabProject[]>(url, {
        headers: this.headers,
        params: { per_page: 100, simple: true },
      }),
    );

    return data;
  }

  /**
   * Gets a single project by its numeric ID.
   *
   * @param projectId - GitLab project ID
   * @returns The project details
   */
  async getProject(projectId: number): Promise<GitLabProject> {
    const { data } = await firstValueFrom(
      this.httpService.get<GitLabProject>(`${this.baseUrl}/api/v4/projects/${projectId}`, {
        headers: this.headers,
      }),
    );
    return data;
  }

  /**
   * Permanently deletes a GitLab project.
   *
   * @param projectId - GitLab project ID to delete
   */
  async deleteProject(projectId: number): Promise<void> {
    this.logger.warn(`Deleting GitLab project id=${projectId}`);
    await firstValueFrom(
      this.httpService.delete(`${this.baseUrl}/api/v4/projects/${projectId}`, {
        headers: this.headers,
      }),
    );
  }

  /**
   * Triggers a CI pipeline on a specific branch.
   *
   * @param projectId - GitLab project ID
   * @param ref - Branch name (defaults to "main")
   */
  async triggerPipeline(projectId: number, ref = 'main'): Promise<void> {
    this.logger.log(`Triggering pipeline for project ${projectId} on ref="${ref}"`);
    await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/api/v4/projects/${projectId}/pipeline`,
        { ref },
        { headers: this.headers },
      ),
    );
  }

  /**
   * Creates a new GitLab project (not a fork) inside the specified group.
   *
   * @param groupId - Namespace/group ID to create the project in
   * @param name - Project name (also used as the URL path)
   * @param description - Optional project description
   * @param initializeWithReadme - Whether to initialize with a README (defaults to true)
   * @returns The newly created GitLab project
   */
  async createNewProject(
    groupId: number,
    name: string,
    description?: string,
    initializeWithReadme = true,
  ): Promise<GitLabProject> {
    this.logger.log(`Creating new project "${name}" in group ${groupId}`);

    const { data } = await firstValueFrom(
      this.httpService.post<GitLabProject>(
        `${this.baseUrl}/api/v4/projects`,
        {
          name,
          path: name.toLowerCase().replaceAll(/\s+/g, '-'),
          namespace_id: groupId,
          description,
          visibility: 'internal',
          initialize_with_readme: initializeWithReadme,
        },
        { headers: this.headers },
      ),
    );

    this.logger.log(`Project created: "${data.path_with_namespace}" (id=${data.id})`);
    return data;
  }

  /**
   * Reads the content of a file from a GitLab repository.
   * The content is returned base64-decoded.
   *
   * @param projectId - GitLab project ID
   * @param filePath - Path to the file within the repository
   * @param ref - Branch/tag/commit (defaults to the project's default branch)
   * @returns Decoded file content as a string, or null if the file doesn't exist
   */
  async getFileContent(projectId: number, filePath: string, ref?: string): Promise<string | null> {
    const encodedPath = encodeURIComponent(filePath);
    this.logger.debug(
      `Reading file "${filePath}" from project ${projectId} (ref=${ref ?? 'default'})`,
    );

    try {
      const { data } = await firstValueFrom(
        this.httpService.get<GitLabFileContent>(
          `${this.baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedPath}`,
          {
            headers: this.headers,
            params: ref ? { ref } : { ref: 'main' },
          },
        ),
      );
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        this.logger.debug(`File "${filePath}" not found in project ${projectId}`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Creates a new file in a GitLab repository via commit.
   *
   * @param projectId - GitLab project ID
   * @param filePath - Path for the new file
   * @param content - File content (plain text, will be base64-encoded)
   * @param commitMessage - Commit message for the file creation
   * @param branch - Target branch (defaults to "main")
   */
  async createFile(
    projectId: number,
    filePath: string,
    content: string,
    commitMessage: string,
    branch = 'main',
  ): Promise<void> {
    const encodedPath = encodeURIComponent(filePath);
    this.logger.log(`Creating file "${filePath}" in project ${projectId} on branch "${branch}"`);

    await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedPath}`,
        {
          branch,
          content,
          commit_message: commitMessage,
          encoding: 'text',
        },
        { headers: this.headers },
      ),
    );
  }

  /**
   * Updates an existing file in a GitLab repository via commit.
   *
   * @param projectId - GitLab project ID
   * @param filePath - Path to the existing file
   * @param content - New file content (plain text)
   * @param commitMessage - Commit message for the update
   * @param branch - Target branch (defaults to "main")
   */
  async updateFile(
    projectId: number,
    filePath: string,
    content: string,
    commitMessage: string,
    branch = 'main',
  ): Promise<void> {
    const encodedPath = encodeURIComponent(filePath);
    this.logger.log(`Updating file "${filePath}" in project ${projectId} on branch "${branch}"`);

    await firstValueFrom(
      this.httpService.put(
        `${this.baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedPath}`,
        {
          branch,
          content,
          commit_message: commitMessage,
          encoding: 'text',
        },
        { headers: this.headers },
      ),
    );
  }

  /**
   * Creates or updates a file in a GitLab repository.
   * Tries to update first; if the file doesn't exist, creates it.
   *
   * @param projectId - GitLab project ID
   * @param filePath - File path within the repository
   * @param content - File content (plain text)
   * @param commitMessage - Commit message
   * @param branch - Target branch (defaults to "main")
   */
  async upsertFile(
    projectId: number,
    filePath: string,
    content: string,
    commitMessage: string,
    branch = 'main',
  ): Promise<void> {
    const existing = await this.getFileContent(projectId, filePath, branch);
    if (existing === null) {
      await this.createFile(projectId, filePath, content, commitMessage, branch);
    } else {
      await this.updateFile(projectId, filePath, content, commitMessage, branch);
    }
  }

  /**
   * Lists the repository tree (files and directories) for a project.
   *
   * @param projectId - GitLab project ID
   * @param path - Subdirectory path to list (defaults to root)
   * @param ref - Branch/tag/commit (defaults to "main")
   * @param recursive - Whether to list recursively (defaults to false)
   * @returns Array of tree items (files and directories)
   */
  async getProjectTree(
    projectId: number,
    path?: string,
    ref = 'main',
    recursive = false,
  ): Promise<GitLabTreeItem[]> {
    this.logger.debug(
      `Listing tree for project ${projectId} path="${path ?? '/'}" ref="${ref}" recursive=${recursive}`,
    );

    const { data } = await firstValueFrom(
      this.httpService.get<GitLabTreeItem[]>(
        `${this.baseUrl}/api/v4/projects/${projectId}/repository/tree`,
        {
          headers: this.headers,
          params: {
            ref,
            per_page: 100,
            recursive,
            ...(path && { path }),
          },
        },
      ),
    );
    return data;
  }

  /**
   * Checks whether a route/service hostname already exists in Kong
   * by querying the GitLab projects list (used for domain conflict detection).
   *
   * @param groupId - Group to search in
   * @param projectSlug - Project slug to look for
   * @returns The project if found, undefined otherwise
   */
  async findProjectInGroupPublic(
    groupId: number,
    projectSlug: string,
  ): Promise<GitLabProject | undefined> {
    return this.findProjectInGroup(groupId, projectSlug);
  }

  private async findGroup(name: string, parentId?: number): Promise<GitLabGroup | undefined> {
    const { data } = await firstValueFrom(
      this.httpService.get<GitLabGroup[]>(`${this.baseUrl}/api/v4/groups`, {
        headers: this.headers,
        params: { search: name, ...(parentId && { parent_id: parentId }) },
      }),
    );
    return data.find(
      (g) => g.name === name || g.path === name.toLowerCase().replaceAll(/\s+/g, '-'),
    );
  }

  private async createGroup(name: string, parentId?: number): Promise<GitLabGroup> {
    const { data } = await firstValueFrom(
      this.httpService.post<GitLabGroup>(
        `${this.baseUrl}/api/v4/groups`,
        {
          name,
          path: name.toLowerCase().replaceAll(/\s+/g, '-'),
          ...(parentId && { parent_id: parentId }),
          visibility: 'internal',
        },
        { headers: this.headers },
      ),
    );
    return data;
  }

  private async findProjectInGroup(
    groupId: number,
    projectName: string,
  ): Promise<GitLabProject | undefined> {
    const { data } = await firstValueFrom(
      this.httpService.get<GitLabProject[]>(`${this.baseUrl}/api/v4/groups/${groupId}/projects`, {
        headers: this.headers,
        params: { search: projectName, simple: true },
      }),
    );
    return data.find(
      (p) => p.name === projectName || p.path_with_namespace.endsWith(`/${projectName}`),
    );
  }
}
