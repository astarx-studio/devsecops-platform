import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';

import type { AxiosResponse } from 'axios';

import { GitLabProject, GitLabGroup, GitLabService, GitLabTreeItem } from './gitlab.service';
import { createMockConfigService } from '../../test/helpers/mock-providers';
import {
  gitlabProjectFactory,
  gitlabGroupFactory,
  gitlabTreeItemFactory,
} from '../../test/helpers/factories';

function axiosResponse<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} } as AxiosResponse<T>;
}

describe('GitLabService', () => {
  let service: GitLabService;

  /**
   * Standalone mock function references for HttpService methods.
   * Using standalone variables in `expect()` calls avoids the
   * @typescript-eslint/unbound-method error that fires when methods are
   * extracted from their object context via property access.
   */
  let getFn: jest.Mock;
  let postFn: jest.Mock;
  let putFn: jest.Mock;
  let deleteFn: jest.Mock;

  beforeEach(() => {
    getFn = jest.fn();
    postFn = jest.fn();
    putFn = jest.fn();
    deleteFn = jest.fn();

    service = new GitLabService(
      { get: getFn, post: postFn, put: putFn, delete: deleteFn } as unknown as HttpService,
      createMockConfigService(),
    );
  });

  describe('templateGroup / configGroup', () => {
    it('should return configured template group ID', () => {
      expect(service.templateGroup).toBe(10);
    });

    it('should return configured config group ID', () => {
      expect(service.configGroup).toBe(20);
    });
  });

  describe('createGroupHierarchy', () => {
    it('should create nested groups and return the deepest ID', async () => {
      const rootGroup = gitlabGroupFactory({ id: 1, name: 'clients', path: 'clients' });
      const childGroup = gitlabGroupFactory({ id: 2, name: 'acme', path: 'acme' });

      getFn
        .mockReturnValueOnce(of(axiosResponse<GitLabGroup[]>([])))
        .mockReturnValueOnce(of(axiosResponse<GitLabGroup[]>([])));
      postFn
        .mockReturnValueOnce(of(axiosResponse(rootGroup)))
        .mockReturnValueOnce(of(axiosResponse(childGroup)));

      const result = await service.createGroupHierarchy(['clients', 'acme']);

      expect(result).toBe(2);
      expect(getFn).toHaveBeenCalledTimes(2);
      expect(postFn).toHaveBeenCalledTimes(2);
    });

    it('should reuse existing groups', async () => {
      const existingGroup = gitlabGroupFactory({ id: 5, name: 'clients', path: 'clients' });
      getFn.mockReturnValueOnce(of(axiosResponse([existingGroup])));

      const result = await service.createGroupHierarchy(['clients']);

      expect(result).toBe(5);
      expect(postFn).not.toHaveBeenCalled();
    });
  });

  describe('forkTemplate', () => {
    it('should fork a template project into the target group', async () => {
      const templateProject = gitlabProjectFactory({ id: 50, name: 'nestjs-app' });
      const forkedProject = gitlabProjectFactory({
        id: 99,
        name: 'webapp',
        path_with_namespace: 'clients/acme/webapp',
      });

      getFn.mockReturnValueOnce(of(axiosResponse([templateProject])));
      postFn.mockReturnValueOnce(of(axiosResponse(forkedProject)));

      const result = await service.forkTemplate('nestjs-app', 42, 'webapp');

      expect(result.id).toBe(99);
      expect(result.name).toBe('webapp');
      expect(postFn).toHaveBeenCalledWith(
        expect.stringContaining('/projects/50/fork'),
        expect.objectContaining({ namespace_id: 42, name: 'webapp' }),
        expect.any(Object),
      );
    });

    it('should throw when template is not found', async () => {
      getFn.mockReturnValueOnce(of(axiosResponse<GitLabProject[]>([])));

      await expect(service.forkTemplate('nonexistent', 42, 'webapp')).rejects.toThrow(
        'Template "nonexistent" not found',
      );
    });
  });

  describe('listProjects', () => {
    it('should list all projects when no groupId given', async () => {
      const projects = [gitlabProjectFactory(), gitlabProjectFactory()];
      getFn.mockReturnValueOnce(of(axiosResponse(projects)));

      const result = await service.listProjects();

      expect(result).toHaveLength(2);
      expect(getFn).toHaveBeenCalledWith(
        expect.stringContaining('/api/v4/projects'),
        expect.objectContaining({ params: { per_page: 100, simple: true } }),
      );
    });

    it('should list projects filtered by groupId', async () => {
      getFn.mockReturnValueOnce(of(axiosResponse([gitlabProjectFactory()])));

      const result = await service.listProjects(5);

      expect(result).toHaveLength(1);
      expect(getFn).toHaveBeenCalledWith(
        expect.stringContaining('/api/v4/groups/5/projects'),
        expect.any(Object),
      );
    });
  });

  describe('getProject', () => {
    it('should return a project by ID', async () => {
      const project = gitlabProjectFactory({ id: 42 });
      getFn.mockReturnValueOnce(of(axiosResponse(project)));

      const result = await service.getProject(42);

      expect(result.id).toBe(42);
      expect(getFn).toHaveBeenCalledWith(
        expect.stringContaining('/api/v4/projects/42'),
        expect.any(Object),
      );
    });
  });

  describe('deleteProject', () => {
    it('should call DELETE on the project', async () => {
      deleteFn.mockReturnValueOnce(of(axiosResponse(undefined)));

      await service.deleteProject(42);

      expect(deleteFn).toHaveBeenCalledWith(
        expect.stringContaining('/api/v4/projects/42'),
        expect.any(Object),
      );
    });
  });

  describe('triggerPipeline', () => {
    it('should trigger pipeline with default ref', async () => {
      postFn.mockReturnValueOnce(of(axiosResponse({})));

      await service.triggerPipeline(42);

      expect(postFn).toHaveBeenCalledWith(
        expect.stringContaining('/api/v4/projects/42/pipeline'),
        { ref: 'main' },
        expect.any(Object),
      );
    });

    it('should trigger pipeline with custom ref', async () => {
      postFn.mockReturnValueOnce(of(axiosResponse({})));

      await service.triggerPipeline(42, 'develop');

      expect(postFn).toHaveBeenCalledWith(
        expect.stringContaining('/api/v4/projects/42/pipeline'),
        { ref: 'develop' },
        expect.any(Object),
      );
    });
  });

  describe('createNewProject', () => {
    it('should create a new project with correct params', async () => {
      const project = gitlabProjectFactory({ id: 77, name: 'my-lib' });
      postFn.mockReturnValueOnce(of(axiosResponse(project)));

      const result = await service.createNewProject(10, 'my-lib', 'A library', true);

      expect(result.id).toBe(77);
      expect(postFn).toHaveBeenCalledWith(
        expect.stringContaining('/api/v4/projects'),
        expect.objectContaining({
          name: 'my-lib',
          namespace_id: 10,
          description: 'A library',
          visibility: 'internal',
          initialize_with_readme: true,
        }),
        expect.any(Object),
      );
    });
  });

  describe('getFileContent', () => {
    it('should decode base64 content', async () => {
      const base64Content = Buffer.from('hello world').toString('base64');
      getFn.mockReturnValueOnce(of(axiosResponse({ content: base64Content, encoding: 'base64' })));

      const result = await service.getFileContent(42, 'README.md');

      expect(result).toBe('hello world');
    });

    it('should return null on 404', async () => {
      getFn.mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })));

      const result = await service.getFileContent(42, 'nonexistent.txt');

      expect(result).toBeNull();
    });

    it('should rethrow non-404 errors', async () => {
      const error = { response: { status: 500 }, message: 'Server error' };
      getFn.mockReturnValueOnce(throwError(() => error));

      await expect(service.getFileContent(42, 'file.txt')).rejects.toEqual(error);
    });
  });

  describe('upsertFile', () => {
    it('should create file when it does not exist', async () => {
      getFn.mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })));
      postFn.mockReturnValueOnce(of(axiosResponse({})));

      await service.upsertFile(42, 'new-file.txt', 'content', 'add file');

      expect(postFn).toHaveBeenCalledWith(
        expect.stringContaining('/repository/files/'),
        expect.objectContaining({ content: 'content', commit_message: 'add file' }),
        expect.any(Object),
      );
    });

    it('should update file when it already exists', async () => {
      const base64Content = Buffer.from('old content').toString('base64');
      getFn.mockReturnValueOnce(of(axiosResponse({ content: base64Content, encoding: 'base64' })));
      putFn.mockReturnValueOnce(of(axiosResponse({})));

      await service.upsertFile(42, 'existing.txt', 'new content', 'update file');

      expect(putFn).toHaveBeenCalledWith(
        expect.stringContaining('/repository/files/'),
        expect.objectContaining({ content: 'new content', commit_message: 'update file' }),
        expect.any(Object),
      );
    });
  });

  describe('getProjectTree', () => {
    it('should list tree with default params', async () => {
      const items: GitLabTreeItem[] = [
        gitlabTreeItemFactory({ name: 'src', type: 'tree', path: 'src' }),
        gitlabTreeItemFactory({ name: 'main.ts', type: 'blob', path: 'src/main.ts' }),
      ];
      getFn.mockReturnValueOnce(of(axiosResponse(items)));

      const result = await service.getProjectTree(42);

      expect(result).toHaveLength(2);
      expect(getFn).toHaveBeenCalledWith(
        expect.stringContaining('/repository/tree'),
        expect.objectContaining({
          params: { ref: 'main', per_page: 100, recursive: false },
        }),
      );
    });

    it('should pass path, ref, and recursive params', async () => {
      getFn.mockReturnValueOnce(of(axiosResponse([])));

      await service.getProjectTree(42, 'src', 'develop', true);

      expect(getFn).toHaveBeenCalledWith(
        expect.stringContaining('/repository/tree'),
        expect.objectContaining({
          params: { ref: 'develop', per_page: 100, recursive: true, path: 'src' },
        }),
      );
    });
  });

  describe('findProjectInGroupPublic', () => {
    it('should find a project by slug in a group', async () => {
      const project = gitlabProjectFactory({
        name: 'nestjs-app',
        path_with_namespace: 'templates/nestjs-app',
      });
      getFn.mockReturnValueOnce(of(axiosResponse([project])));

      const result = await service.findProjectInGroupPublic(10, 'nestjs-app');

      expect(result).toBeDefined();
      expect(result!.name).toBe('nestjs-app');
    });

    it('should return undefined when project is not found', async () => {
      getFn.mockReturnValueOnce(of(axiosResponse<GitLabProject[]>([])));

      const result = await service.findProjectInGroupPublic(10, 'nonexistent');

      expect(result).toBeUndefined();
    });
  });
});
