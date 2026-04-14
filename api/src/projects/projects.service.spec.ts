import { NotFoundException } from '@nestjs/common';

import { ProjectsService } from './projects.service';
import { GitLabService, GitLabProject } from '../gitlab/gitlab.service';
import { KongService } from '../kong/kong.service';
import { VaultService } from '../vault/vault.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CreateProjectDto } from './dto';
import { createMockConfigService } from '../../test/helpers/mock-providers';
import { gitlabProjectFactory } from '../../test/helpers/factories';

const forkedProject = gitlabProjectFactory({
  id: 42,
  name: 'webapp',
  path_with_namespace: 'clients/acme/webapp',
  web_url: 'https://gitlab.devops.test.net/clients/acme/webapp',
});

describe('ProjectsService', () => {
  let service: ProjectsService;

  /**
   * Standalone mock function references for each service method.
   * Using standalone variables (instead of `service.method`) in `expect()` calls
   * avoids the @typescript-eslint/unbound-method lint error, which fires when a
   * method is extracted from its object context.
   */
  let createGroupHierarchyFn: jest.Mock;
  let forkTemplateFn: jest.Mock;
  let getFileContentFn: jest.Mock;
  /** Explicitly typed so mock.calls[0][2] resolves to string, not any. */
  let upsertFileFn: jest.Mock<Promise<void>, [number, string, string, string, string?]>;
  let triggerPipelineFn: jest.Mock;
  let listProjectsFn: jest.Mock;
  let getProjectFn: jest.Mock;
  let deleteProjectFn: jest.Mock;
  let registerServiceFn: jest.Mock;
  let removeServiceFn: jest.Mock;
  let writeSecretsFn: jest.Mock;
  let deleteSecretsFn: jest.Mock;
  let addDnsRecordFn: jest.Mock;
  let removeDnsRecordFn: jest.Mock;

  let gitlabService: jest.Mocked<GitLabService>;
  let kongService: jest.Mocked<KongService>;
  let vaultService: jest.Mocked<VaultService>;
  let cloudflareService: jest.Mocked<CloudflareService>;

  beforeEach(() => {
    createGroupHierarchyFn = jest.fn().mockResolvedValue(5);
    forkTemplateFn = jest.fn().mockResolvedValue(forkedProject);
    getFileContentFn = jest.fn().mockResolvedValue(null);
    upsertFileFn = jest
      .fn<Promise<void>, [number, string, string, string, string?]>()
      .mockResolvedValue(undefined);
    triggerPipelineFn = jest.fn().mockResolvedValue(undefined);
    listProjectsFn = jest.fn().mockResolvedValue([]);
    getProjectFn = jest.fn().mockResolvedValue(forkedProject);
    deleteProjectFn = jest.fn().mockResolvedValue(undefined);
    registerServiceFn = jest.fn().mockResolvedValue({ serviceName: 'svc', hosts: [] });
    removeServiceFn = jest.fn().mockResolvedValue(undefined);
    writeSecretsFn = jest.fn().mockResolvedValue(undefined);
    deleteSecretsFn = jest.fn().mockResolvedValue(undefined);
    addDnsRecordFn = jest.fn().mockResolvedValue(true);
    removeDnsRecordFn = jest.fn().mockResolvedValue(true);

    gitlabService = {
      createGroupHierarchy: createGroupHierarchyFn,
      forkTemplate: forkTemplateFn,
      getFileContent: getFileContentFn,
      upsertFile: upsertFileFn,
      triggerPipeline: triggerPipelineFn,
      listProjects: listProjectsFn,
      getProject: getProjectFn,
      deleteProject: deleteProjectFn,
      templateGroup: 10,
      configGroup: 20,
    } as unknown as jest.Mocked<GitLabService>;

    kongService = {
      registerService: registerServiceFn,
      removeService: removeServiceFn,
    } as unknown as jest.Mocked<KongService>;

    vaultService = {
      writeSecrets: writeSecretsFn,
      deleteSecrets: deleteSecretsFn,
    } as unknown as jest.Mocked<VaultService>;

    cloudflareService = {
      addDnsRecord: addDnsRecordFn,
      removeDnsRecord: removeDnsRecordFn,
    } as unknown as jest.Mocked<CloudflareService>;

    service = new ProjectsService(
      gitlabService,
      kongService,
      vaultService,
      cloudflareService,
      createMockConfigService(),
    );
  });

  describe('createProject', () => {
    const baseDto: CreateProjectDto = {
      clientName: 'acme',
      projectName: 'webapp',
      templateSlug: 'nestjs-app',
    };

    it('should create a project with no capabilities (plain repo)', async () => {
      const result = await service.createProject(baseDto);

      expect(createGroupHierarchyFn).toHaveBeenCalledWith(['clients', 'acme']);
      expect(forkTemplateFn).toHaveBeenCalledWith('nestjs-app', 5, 'webapp');
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/acme/webapp',
        expect.objectContaining({
          PROJECT_NAME: 'webapp',
          CLIENT_NAME: 'acme',
        }),
      );
      expect(registerServiceFn).not.toHaveBeenCalled();
      expect(addDnsRecordFn).not.toHaveBeenCalled();

      expect(result.id).toBe(42);
      expect(result.name).toBe('webapp');
      expect(result.appUrl).toBeUndefined();
      expect(result.packageName).toBeUndefined();
    });

    it('should create a deployable project with Kong + Cloudflare + pipeline', async () => {
      const dto: CreateProjectDto = {
        ...baseDto,
        capabilities: { deployable: { autoDeploy: true } },
      };

      const result = await service.createProject(dto);

      expect(registerServiceFn).toHaveBeenCalledWith(
        'acme-webapp-service',
        'http://acme-webapp:3000',
        ['webapp.apps.test.net'],
      );
      expect(addDnsRecordFn).toHaveBeenCalledWith('webapp.apps.test.net');
      expect(triggerPipelineFn).toHaveBeenCalledWith(42);
      expect(result.appUrl).toBe('webapp.apps.test.net');
      expect(result.kongServiceName).toBe('acme-webapp-service');
      expect(result.cloudflareConfigured).toBe(true);
    });

    it('should create a deployable project with custom domain', async () => {
      const dto: CreateProjectDto = {
        ...baseDto,
        capabilities: { deployable: { domain: 'custom.example.com' } },
      };

      const result = await service.createProject(dto);

      expect(registerServiceFn).toHaveBeenCalledWith('acme-webapp-service', expect.any(String), [
        'custom.example.com',
      ]);
      expect(result.appUrl).toBe('custom.example.com');
    });

    it('should create a publishable project', async () => {
      const dto: CreateProjectDto = {
        ...baseDto,
        capabilities: { publishable: {} },
      };

      const result = await service.createProject(dto);

      expect(registerServiceFn).not.toHaveBeenCalled();
      expect(result.packageName).toBe('@acme/webapp');
      expect(result.registryUrl).toContain('/-/packages');
    });

    it('should create a project with both capabilities', async () => {
      const dto: CreateProjectDto = {
        ...baseDto,
        capabilities: { deployable: {}, publishable: { packageName: '@acme/web-ui' } },
      };

      const result = await service.createProject(dto);

      expect(registerServiceFn).toHaveBeenCalled();
      expect(result.appUrl).toBeDefined();
      expect(result.packageName).toBe('@acme/web-ui');
    });

    it('should inject config includes into .gitlab-ci.yml', async () => {
      const dto: CreateProjectDto = {
        ...baseDto,
        configs: ['node-pipeline', 'docker-pipeline'],
      };

      await service.createProject(dto);

      expect(getFileContentFn).toHaveBeenCalledWith(42, '.gitlab-ci.yml');
      expect(upsertFileFn).toHaveBeenCalledWith(
        42,
        '.gitlab-ci.yml',
        expect.stringContaining('configs/node-pipeline'),
        expect.stringContaining('inject config includes'),
      );
    });

    it('should merge with existing CI includes without duplicating', async () => {
      const existingCi = `include:\n  - project: "configs/node-pipeline"\n    file: "/.gitlab-ci.yml"\n`;
      getFileContentFn.mockResolvedValueOnce(existingCi);

      const dto: CreateProjectDto = {
        ...baseDto,
        configs: ['node-pipeline', 'docker-pipeline'],
      };

      await service.createProject(dto);

      const writtenContent = upsertFileFn.mock.calls[0][2];
      const nodeMatches = writtenContent.match(/configs\/node-pipeline/g);
      expect(nodeMatches).toHaveLength(1);
      expect(writtenContent).toContain('configs/docker-pipeline');
    });

    it('should continue when Cloudflare DNS fails (non-critical)', async () => {
      addDnsRecordFn.mockRejectedValueOnce(new Error('CF error'));

      const dto: CreateProjectDto = {
        ...baseDto,
        capabilities: { deployable: {} },
      };

      const result = await service.createProject(dto);

      expect(result.cloudflareConfigured).toBe(false);
      expect(result.id).toBe(42);
    });

    it('should continue when pipeline trigger fails (non-critical)', async () => {
      triggerPipelineFn.mockRejectedValueOnce(new Error('Pipeline error'));

      const dto: CreateProjectDto = {
        ...baseDto,
        capabilities: { deployable: { autoDeploy: true } },
      };

      const result = await service.createProject(dto);

      expect(result.id).toBe(42);
    });

    it('should skip pipeline trigger when autoDeploy is false', async () => {
      const dto: CreateProjectDto = {
        ...baseDto,
        capabilities: { deployable: { autoDeploy: false } },
      };

      await service.createProject(dto);

      expect(triggerPipelineFn).not.toHaveBeenCalled();
    });

    it('should use custom groupPath when provided', async () => {
      const dto: CreateProjectDto = {
        ...baseDto,
        groupPath: ['org', 'team', 'frontend'],
      };

      await service.createProject(dto);

      expect(createGroupHierarchyFn).toHaveBeenCalledWith(['org', 'team', 'frontend']);
    });

    it('should pass envVars to vault secrets', async () => {
      const dto: CreateProjectDto = {
        ...baseDto,
        envVars: { DATABASE_URL: 'pg://...', JWT_SECRET: 'secret' },
      };

      await service.createProject(dto);

      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/acme/webapp',
        expect.objectContaining({
          DATABASE_URL: 'pg://...',
          JWT_SECRET: 'secret',
        }),
      );
    });
  });

  describe('listProjects', () => {
    it('should map GitLab projects to DTOs', async () => {
      listProjectsFn.mockResolvedValueOnce([
        gitlabProjectFactory({
          id: 1,
          name: 'webapp',
          path_with_namespace: 'clients/acme/webapp',
          web_url: 'https://gitlab.devops.test.net/clients/acme/webapp',
        }),
      ]);

      const result = await service.listProjects();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 1,
          name: 'webapp',
          clientName: 'acme',
          vaultPath: 'projects/acme/webapp',
        }),
      );
    });

    it('should default clientName to "unknown" for shallow paths', async () => {
      listProjectsFn.mockResolvedValueOnce([
        gitlabProjectFactory({
          id: 2,
          name: 'solo',
          path_with_namespace: 'root/solo',
          web_url: 'https://gitlab.devops.test.net/root/solo',
        }),
      ]);

      const result = await service.listProjects();

      expect(result[0].clientName).toBe('unknown');
    });
  });

  describe('getProject', () => {
    it('should return a ProjectInfoDto', async () => {
      const result = await service.getProject(42);

      expect(result.id).toBe(42);
      expect(result.name).toBe('webapp');
      expect(result.clientName).toBe('acme');
    });

    it('should throw NotFoundException when project is null', async () => {
      getProjectFn.mockResolvedValueOnce(null as unknown as GitLabProject);

      await expect(service.getProject(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteProject', () => {
    it('should clean up Kong, Cloudflare, Vault, and GitLab in order', async () => {
      await service.deleteProject(42);

      expect(removeServiceFn).toHaveBeenCalledWith('acme-webapp-service');
      expect(removeDnsRecordFn).toHaveBeenCalledWith('webapp.apps.test.net');
      expect(deleteSecretsFn).toHaveBeenCalledWith('projects/acme/webapp');
      expect(deleteProjectFn).toHaveBeenCalledWith(42);
    });

    it('should continue when Kong cleanup fails (non-critical)', async () => {
      removeServiceFn.mockRejectedValueOnce(new Error('Kong error'));

      await expect(service.deleteProject(42)).resolves.toBeUndefined();
      expect(deleteProjectFn).toHaveBeenCalledWith(42);
    });

    it('should continue when Cloudflare cleanup fails (non-critical)', async () => {
      removeDnsRecordFn.mockRejectedValueOnce(new Error('CF error'));

      await expect(service.deleteProject(42)).resolves.toBeUndefined();
      expect(deleteProjectFn).toHaveBeenCalledWith(42);
    });

    it('should continue when Vault cleanup fails (non-critical)', async () => {
      deleteSecretsFn.mockRejectedValueOnce(new Error('Vault error'));

      await expect(service.deleteProject(42)).resolves.toBeUndefined();
      expect(deleteProjectFn).toHaveBeenCalledWith(42);
    });
  });

  describe('resolveUpstreamUrl (via createProject)', () => {
    it('should use local mode by default', async () => {
      const dto: CreateProjectDto = {
        clientName: 'acme',
        projectName: 'webapp',
        templateSlug: 'nestjs-app',
        capabilities: { deployable: {} },
      };

      await service.createProject(dto);

      expect(registerServiceFn).toHaveBeenCalledWith(
        expect.any(String),
        'http://acme-webapp:3000',
        expect.any(Array),
      );
    });

  });
});
