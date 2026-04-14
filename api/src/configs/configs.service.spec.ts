import { ConflictException, NotFoundException } from '@nestjs/common';

import { ConfigsService } from './configs.service';
import { GitLabService } from '../gitlab/gitlab.service';
import { gitlabProjectFactory, gitlabTreeItemFactory } from '../../test/helpers/factories';

describe('ConfigsService', () => {
  let service: ConfigsService;

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

    service = new ConfigsService({
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

  describe('listConfigs', () => {
    it('should map GitLab projects to ConfigInfoDto[]', async () => {
      const project = gitlabProjectFactory({
        id: 1,
        name: 'node-pipeline',
        description: 'Node CI',
        web_url: 'https://gitlab.test/configs/node-pipeline',
        last_activity_at: '2026-01-01T00:00:00Z',
      });
      listProjectsFn.mockResolvedValueOnce([project]);

      const result = await service.listConfigs();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        slug: 'node-pipeline',
        description: 'Node CI',
        gitlabUrl: 'https://gitlab.test/configs/node-pipeline',
        lastActivityAt: '2026-01-01T00:00:00Z',
      });
      expect(listProjectsFn).toHaveBeenCalledWith(20);
    });
  });

  describe('getConfig', () => {
    it('should return config with file tree', async () => {
      const project = gitlabProjectFactory({ id: 3, name: 'node-pipeline' });
      findProjectFn.mockResolvedValueOnce(project);
      const files = [
        gitlabTreeItemFactory({ name: '.gitlab-ci.yml', path: '.gitlab-ci.yml', type: 'blob' }),
      ];
      getProjectTreeFn.mockResolvedValueOnce(files);

      const result = await service.getConfig('node-pipeline');

      expect(result.id).toBe(3);
      expect(result.files).toEqual(files);
    });

    it('should throw NotFoundException when config not found', async () => {
      findProjectFn.mockResolvedValueOnce(undefined);

      await expect(service.getConfig('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createConfig', () => {
    it('should create a new project and write .gitlab-ci.yml', async () => {
      const created = gitlabProjectFactory({
        id: 15,
        name: 'docker-pipeline',
        description: 'Docker CI',
      });
      findProjectFn.mockResolvedValueOnce(undefined);
      createNewProjectFn.mockResolvedValueOnce(created);

      const result = await service.createConfig({
        slug: 'docker-pipeline',
        description: 'Docker CI',
        ciContent: '.build:\n  script: docker build .',
      });

      expect(result.id).toBe(15);
      expect(createNewProjectFn).toHaveBeenCalledWith(20, 'docker-pipeline', 'Docker CI', true);
      expect(upsertFileFn).toHaveBeenCalledWith(
        15,
        '.gitlab-ci.yml',
        '.build:\n  script: docker build .',
        'chore: initialize shared CI config',
      );
    });

    it('should throw ConflictException when slug already exists', async () => {
      findProjectFn.mockResolvedValueOnce(gitlabProjectFactory({ id: 99 }));

      await expect(
        service.createConfig({ slug: 'duplicate', ciContent: 'content' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateConfigFiles', () => {
    it('should upsert the specified file', async () => {
      const project = gitlabProjectFactory({ id: 5, name: 'node-pipeline' });
      findProjectFn.mockResolvedValueOnce(project);

      await service.updateConfigFiles('node-pipeline', {
        filePath: '.gitlab-ci.yml',
        content: 'updated content',
        commitMessage: 'chore: update',
      });

      expect(upsertFileFn).toHaveBeenCalledWith(
        5,
        '.gitlab-ci.yml',
        'updated content',
        'chore: update',
      );
    });

    it('should throw NotFoundException when config not found', async () => {
      findProjectFn.mockResolvedValueOnce(undefined);

      await expect(
        service.updateConfigFiles('missing', {
          filePath: '.gitlab-ci.yml',
          content: 'x',
          commitMessage: 'y',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteConfig', () => {
    it('should find and delete the config project', async () => {
      const project = gitlabProjectFactory({ id: 8, name: 'old-config' });
      findProjectFn.mockResolvedValueOnce(project);

      await service.deleteConfig('old-config');

      expect(deleteProjectFn).toHaveBeenCalledWith(8);
    });

    it('should throw NotFoundException when config not found', async () => {
      findProjectFn.mockResolvedValueOnce(undefined);

      await expect(service.deleteConfig('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
