import { ConflictException, NotFoundException } from '@nestjs/common';

import { TemplatesService } from './templates.service';
import { GitLabService } from '../gitlab/gitlab.service';
import { gitlabProjectFactory, gitlabTreeItemFactory } from '../../test/helpers/factories';

describe('TemplatesService', () => {
  let service: TemplatesService;

  /** Standalone mock function references — avoids unbound-method lint errors */
  let listProjectsFn: jest.Mock;
  let findProjectFn: jest.Mock;
  let createNewProjectFn: jest.Mock;
  let upsertFileFn: jest.Mock;
  let deleteProjectFn: jest.Mock;
  let getProjectTreeFn: jest.Mock;

  beforeEach(() => {
    listProjectsFn = jest.fn().mockResolvedValue([]);
    findProjectFn = jest.fn().mockResolvedValue(undefined);
    createNewProjectFn = jest.fn();
    upsertFileFn = jest.fn().mockResolvedValue(undefined);
    deleteProjectFn = jest.fn().mockResolvedValue(undefined);
    getProjectTreeFn = jest.fn().mockResolvedValue([]);

    service = new TemplatesService({
      listProjects: listProjectsFn,
      findProjectInGroupPublic: findProjectFn,
      createNewProject: createNewProjectFn,
      upsertFile: upsertFileFn,
      deleteProject: deleteProjectFn,
      getProjectTree: getProjectTreeFn,
      templateGroup: 10,
      configGroup: 20,
    } as unknown as GitLabService);
  });

  describe('listTemplates', () => {
    it('should map GitLab projects to TemplateInfoDto[]', async () => {
      const project = gitlabProjectFactory({
        id: 1,
        name: 'nestjs-app',
        description: 'NestJS starter',
        web_url: 'https://gitlab.test/templates/nestjs-app',
        default_branch: 'main',
        last_activity_at: '2026-01-01T00:00:00Z',
      });
      listProjectsFn.mockResolvedValueOnce([project]);

      const result = await service.listTemplates();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        slug: 'nestjs-app',
        description: 'NestJS starter',
        gitlabUrl: 'https://gitlab.test/templates/nestjs-app',
        defaultBranch: 'main',
        lastActivityAt: '2026-01-01T00:00:00Z',
      });
      expect(listProjectsFn).toHaveBeenCalledWith(10);
    });
  });

  describe('getTemplate', () => {
    it('should return template with file tree', async () => {
      const project = gitlabProjectFactory({ id: 5, name: 'nestjs-app' });
      findProjectFn.mockResolvedValueOnce(project);
      const files = [gitlabTreeItemFactory({ name: 'src', type: 'tree', path: 'src' })];
      getProjectTreeFn.mockResolvedValueOnce(files);

      const result = await service.getTemplate('nestjs-app');

      expect(result.id).toBe(5);
      expect(result.slug).toBe('nestjs-app');
      expect(result.files).toEqual(files);
    });

    it('should throw NotFoundException when template does not exist', async () => {
      findProjectFn.mockResolvedValueOnce(undefined);

      await expect(service.getTemplate('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createTemplate', () => {
    it('should create a new project and return template info', async () => {
      const created = gitlabProjectFactory({
        id: 11,
        name: 'react-app',
        description: 'React starter',
        web_url: 'https://gitlab.test/templates/react-app',
      });
      findProjectFn.mockResolvedValueOnce(undefined);
      createNewProjectFn.mockResolvedValueOnce(created);

      const result = await service.createTemplate({
        slug: 'react-app',
        description: 'React starter',
      });

      expect(result.id).toBe(11);
      expect(result.slug).toBe('react-app');
      expect(createNewProjectFn).toHaveBeenCalledWith(10, 'react-app', 'React starter', true);
    });

    it('should upload files when provided', async () => {
      const created = gitlabProjectFactory({ id: 12, name: 'with-files' });
      findProjectFn.mockResolvedValueOnce(undefined);
      createNewProjectFn.mockResolvedValueOnce(created);

      await service.createTemplate({
        slug: 'with-files',
        files: { Dockerfile: 'FROM node:20', 'src/main.ts': 'console.log("hi")' },
      });

      expect(upsertFileFn).toHaveBeenCalledTimes(2);
      expect(upsertFileFn).toHaveBeenCalledWith(
        12,
        'Dockerfile',
        'FROM node:20',
        'chore: add Dockerfile',
      );
    });

    it('should throw ConflictException when slug already exists', async () => {
      findProjectFn.mockResolvedValueOnce(gitlabProjectFactory({ id: 99 }));

      await expect(service.createTemplate({ slug: 'duplicate' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('deleteTemplate', () => {
    it('should find and delete the template project', async () => {
      const project = gitlabProjectFactory({ id: 7, name: 'old-template' });
      findProjectFn.mockResolvedValueOnce(project);

      await service.deleteTemplate('old-template');

      expect(deleteProjectFn).toHaveBeenCalledWith(7);
    });

    it('should throw NotFoundException when template does not exist', async () => {
      findProjectFn.mockResolvedValueOnce(undefined);

      await expect(service.deleteTemplate('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
