import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import { AppConfiguration } from '../config';
import { isGitLabProjectPendingDeletion } from './gitlab-project.util';

export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  web_url: string;
  description: string | null;
  default_branch: string;
  last_activity_at: string;
  /**
   * The immediate parent namespace (group or user) of this project.
   * Returned by the GitLab REST API `/projects` and `/groups/:id/projects` endpoints.
   * Used in reconciliation to filter out platform-owned meta-groups by stable ID
   * rather than fragile path-string prefix matching.
   */
  namespace?: {
    id: number;
    full_path: string;
  };
  /** Set when the project is scheduled for deletion (path may be unchanged). */
  marked_for_deletion_on?: string | null;
  /** @deprecated Use marked_for_deletion_on */
  marked_for_deletion_at?: string | null;
}

export interface GitLabListProjectsOptions {
  /** When false, includes marked_for_deletion_* fields (default true for list). */
  simple?: boolean;
  /** Include projects pending deletion (admin token). */
  includePendingDelete?: boolean;
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
  async listProjects(
    groupId?: number,
    options?: GitLabListProjectsOptions,
  ): Promise<GitLabProject[]> {
    const url = groupId
      ? `${this.baseUrl}/api/v4/groups/${groupId}/projects`
      : `${this.baseUrl}/api/v4/projects`;

    const params: Record<string, boolean | number> = {
      per_page: 100,
      simple: options?.simple ?? true,
    };
    if (options?.includePendingDelete) {
      params.include_pending_delete = true;
    }

    const { data } = await firstValueFrom(
      this.httpService.get<GitLabProject[]>(url, {
        headers: this.headers,
        params,
      }),
    );

    return data;
  }

  /**
   * Lists all projects with fields required for reconcileGitLabProjects detection
   * (deletion markers, pending-delete projects).
   */
  async listProjectsForReconciliation(): Promise<GitLabProject[]> {
    return this.listProjects(undefined, {
      simple: false,
      includePendingDelete: true,
    });
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
   * Permanently deletes a GitLab project immediately.
   *
   * GitLab 15.2+ soft-deletes projects by renaming and scheduling them for
   * later removal. The `permanently_delete=true` query param bypasses the
   * delayed-deletion queue so the project path is freed straight away,
   * allowing a project with the same name to be recreated without conflict.
   *
   * @param projectId - GitLab project ID to delete
   */
  async deleteProject(projectId: number): Promise<void> {
    this.logger.warn(`Permanently deleting GitLab project id=${projectId}`);
    await firstValueFrom(
      this.httpService.delete(`${this.baseUrl}/api/v4/projects/${projectId}`, {
        headers: this.headers,
        params: { permanently_delete: true },
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
   * Finds a project by slug in the specified group.
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

  /**
   * Sets (or updates) an environment-scoped, masked CI variable on a GitLab project.
   *
   * Uses a GET-check-first approach to decide between PUT (update) and POST (create),
   * which avoids GitLab's silent behaviour of ignoring scope filters on PUT.
   *
   * @param projectId - GitLab project ID
   * @param key - CI variable name (e.g. "KUBE_NAMESPACE")
   * @param value - Variable value (stored masked)
   * @param environmentScope - Environment scope pattern (e.g. "dev", "stg", "prod", or "*")
   * @param masked - Whether the variable should be masked in CI job logs (defaults to true)
   */
  async setProjectCiVariable(
    projectId: number,
    key: string,
    value: string,
    environmentScope = '*',
    masked = true,
  ): Promise<void> {
    const baseUrl = `${this.baseUrl}/api/v4/projects/${projectId}/variables`;

    this.logger.debug(
      `setProjectCiVariable: project=${projectId} key=${key} scope="${environmentScope}"`,
    );

    // GET: check if this key+scope combination already exists
    let exists = false;
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<Array<{ key: string; environment_scope: string }>>(baseUrl, {
          headers: this.headers,
          params: { filter: { environment_scope: environmentScope } },
        }),
      );
      exists = data.some((v) => v.key === key && v.environment_scope === environmentScope);
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status !== 404) {
        throw error;
      }
    }

    const payload = {
      key,
      value,
      variable_type: 'env_var',
      protected: false,
      masked,
      environment_scope: environmentScope,
    };

    if (exists) {
      this.logger.debug(
        `Updating CI variable "${key}" [${environmentScope}] on project ${projectId}`,
      );
      await firstValueFrom(
        this.httpService.put(`${baseUrl}/${key}`, payload, {
          headers: this.headers,
          params: { filter: { environment_scope: environmentScope } },
        }),
      );
    } else {
      this.logger.log(
        `Creating CI variable "${key}" [${environmentScope}] on project ${projectId}`,
      );
      try {
        await firstValueFrom(this.httpService.post(baseUrl, payload, { headers: this.headers }));
      } catch (error: unknown) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status !== 400) {
          throw error;
        }
        this.logger.debug(
          `CI variable "${key}" [${environmentScope}] already exists on project ${projectId} — updating`,
        );
        await firstValueFrom(
          this.httpService.put(`${baseUrl}/${key}`, payload, {
            headers: this.headers,
            params: { filter: { environment_scope: environmentScope } },
          }),
        );
      }
    }
  }

  /**
   * Sets multiple environment-scoped CI variables on a project in a single call sequence.
   * Variables are set sequentially to avoid GitLab API rate limits.
   *
   * @param projectId - GitLab project ID
   * @param variables - Array of variable definitions
   */
  async setProjectCiVariables(
    projectId: number,
    variables: Array<{
      key: string;
      value: string;
      environmentScope: string;
      masked?: boolean;
    }>,
  ): Promise<void> {
    this.logger.log(`Setting ${variables.length} CI variable(s) on project ${projectId}`);
    for (const variable of variables) {
      await this.setProjectCiVariable(
        projectId,
        variable.key,
        variable.value,
        variable.environmentScope,
        variable.masked ?? true,
      );
    }
    this.logger.log(`All ${variables.length} CI variable(s) set on project ${projectId}`);
  }

  /**
   * Deletes a project CI variable for a specific key and environment scope.
   * No-op when the variable does not exist (HTTP 404).
   */
  async deleteProjectCiVariable(
    projectId: number,
    key: string,
    environmentScope: string,
  ): Promise<void> {
    const url = `${this.baseUrl}/api/v4/projects/${projectId}/variables/${encodeURIComponent(key)}`;
    try {
      await firstValueFrom(
        this.httpService.delete(url, {
          headers: this.headers,
          params: { filter: { environment_scope: environmentScope } },
        }),
      );
      this.logger.debug(
        `Deleted CI variable "${key}" [${environmentScope}] on project ${projectId}`,
      );
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        return;
      }
      throw error;
    }
  }

  /**
   * Lists container registry repositories for a GitLab project.
   *
   * @see https://docs.gitlab.com/ee/api/container_registry.html#list-registry-repositories
   */
  private async listRegistryRepositories(
    projectId: number,
  ): Promise<Array<{ id: number; name: string }>> {
    const { data } = await firstValueFrom(
      this.httpService.get<Array<{ id: number; name: string }>>(
        `${this.baseUrl}/api/v4/projects/${projectId}/registry/repositories`,
        { headers: this.headers, params: { per_page: 100 } },
      ),
    );
    return data ?? [];
  }

  /**
   * Deletes a container registry repository (and its tags) for a project.
   */
  private async deleteRegistryRepository(projectId: number, repositoryId: number): Promise<void> {
    await firstValueFrom(
      this.httpService.delete(
        `${this.baseUrl}/api/v4/projects/${projectId}/registry/repositories/${repositoryId}`,
        { headers: this.headers },
      ),
    );
  }

  /**
   * Removes all container registry repositories for a project (best-effort per repo).
   */
  async purgeContainerRegistry(projectId: number): Promise<{ deleted: number; errors: string[] }> {
    const repos = await this.listRegistryRepositories(projectId);
    const errors: string[] = [];
    let deleted = 0;

    for (const repo of repos) {
      try {
        await this.deleteRegistryRepository(projectId, repo.id);
        deleted++;
        this.logger.debug(
          `purgeContainerRegistry: deleted repository id=${repo.id} name=${repo.name} project=${projectId}`,
        );
      } catch (error: unknown) {
        const message = (error as Error).message;
        errors.push(`registry ${repo.name}: ${message}`);
        this.logger.warn(
          `purgeContainerRegistry: failed repository id=${repo.id} project=${projectId}: ${message}`,
        );
      }
    }

    return { deleted, errors };
  }

  /**
   * Deletes all GitLab packages for a project (paginated).
   *
   * @see https://docs.gitlab.com/ee/api/packages.html
   */
  async purgeProjectPackages(projectId: number): Promise<{ deleted: number; errors: string[] }> {
    const errors: string[] = [];
    let deleted = 0;
    let page = 1;

    while (true) {
      const { data } = await firstValueFrom(
        this.httpService.get<Array<{ id: number; name: string }>>(
          `${this.baseUrl}/api/v4/projects/${projectId}/packages`,
          { headers: this.headers, params: { per_page: 100, page } },
        ),
      );

      if (!data?.length) {
        break;
      }

      for (const pkg of data) {
        try {
          await firstValueFrom(
            this.httpService.delete(
              `${this.baseUrl}/api/v4/projects/${projectId}/packages/${pkg.id}`,
              { headers: this.headers },
            ),
          );
          deleted++;
        } catch (error: unknown) {
          const message = (error as Error).message;
          errors.push(`package ${pkg.name}#${pkg.id}: ${message}`);
          this.logger.warn(
            `purgeProjectPackages: failed package id=${pkg.id} project=${projectId}: ${message}`,
          );
        }
      }

      if (data.length < 100) {
        break;
      }
      page++;
    }

    return { deleted, errors };
  }

  /**
   * Purges container registry and generic packages before project deletion.
   */
  async purgeProjectArtifacts(projectId: number): Promise<void> {
    const registry = await this.purgeContainerRegistry(projectId);
    const packages = await this.purgeProjectPackages(projectId);
    this.logger.log(
      `purgeProjectArtifacts: project=${projectId} registryDeleted=${registry.deleted} ` +
        `packagesDeleted=${packages.deleted} registryErrors=${registry.errors.length} ` +
        `packageErrors=${packages.errors.length}`,
    );
  }

  /**
   * Attempts permanent GitLab project deletion.
   *
   * @param options.force - purge registry and packages before delete
   * @returns false when GitLab rejects deletion (e.g. registry still in use)
   */
  async tryDeleteProject(
    projectId: number,
    options?: { force?: boolean },
  ): Promise<{ ok: boolean; message?: string }> {
    if (options?.force) {
      try {
        await this.purgeProjectArtifacts(projectId);
      } catch (error: unknown) {
        this.logger.warn(
          `purgeProjectArtifacts(${projectId}) failed before delete: ${(error as Error).message}`,
        );
      }
    }

    try {
      await this.deleteProject(projectId);
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string } } }).response?.data?.message ??
        (error as Error).message;
      this.logger.warn(`GitLab deleteProject(${projectId}) failed: ${message}`);
      return { ok: false, message };
    }

    try {
      const remaining = await this.getProject(projectId);
      if (isGitLabProjectPendingDeletion(remaining)) {
        return {
          ok: false,
          message:
            'GitLab project is scheduled for deletion (pending instance retention). ' +
            'Use force delete to purge registry and retry, or wait for GitLab to remove it.',
        };
      }
      return {
        ok: false,
        message: `GitLab project ${projectId} still exists after delete request`,
      };
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        return { ok: true };
      }
      const message = (error as Error).message;
      this.logger.warn(`GitLab post-delete check for ${projectId} failed: ${message}`);
      return { ok: false, message };
    }
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
          // Subgroups cannot be more open than a private parent (GitLab returns 400).
          visibility: 'private',
        },
        { headers: this.headers },
      ),
    );
    return data;
  }

  /**
   * Posts a commit status on a GitLab project (canonical contract for CI curl + API callers).
   *
   * @see https://docs.gitlab.com/ee/api/commits.html#post-the-build-status-to-a-commit
   *
   * @param projectId - GitLab project ID
   * @param sha - Commit SHA
   * @param state - pending | running | success | failed | canceled
   * @param name - Status context name (e.g. "sonarqube/quality-gate")
   * @param description - Short human-readable description
   * @param targetUrl - Link to Sonar dashboard or pipeline job
   */
  async postCommitStatus(
    projectId: number,
    sha: string,
    state: 'pending' | 'running' | 'success' | 'failed' | 'canceled',
    name: string,
    description: string,
    targetUrl?: string,
  ): Promise<void> {
    const encodedSha = encodeURIComponent(sha);
    const url = `${this.baseUrl}/api/v4/projects/${projectId}/repository/commits/${encodedSha}/statuses`;

    this.logger.debug(
      `postCommitStatus: project=${projectId} sha=${sha.slice(0, 8)} state=${state} name=${name}`,
    );

    await firstValueFrom(
      this.httpService.post(
        url,
        {
          state,
          name,
          description,
          ...(targetUrl ? { target_url: targetUrl } : {}),
        },
        { headers: this.headers },
      ),
    );
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
