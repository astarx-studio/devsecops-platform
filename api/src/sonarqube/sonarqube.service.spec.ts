import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';

import { createMockConfigService, createMockHttpService } from '../../test/helpers/mock-providers';

import { SonarQubeService } from './sonarqube.service';

describe('SonarQubeService', () => {
  let service: SonarQubeService;
  let httpService: jest.Mocked<HttpService>;

  beforeEach(async () => {
    httpService = createMockHttpService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SonarQubeService,
        {
          provide: HttpService,
          useValue: httpService,
        },
        {
          provide: ConfigService,
          useValue: createMockConfigService({
            'sonarqube.internalUrl': 'http://sonarqube:9000',
            'sonarqube.adminUser': 'admin',
            'sonarqube.adminPassword': 'secret',
          }),
        },
      ],
    }).compile();

    service = module.get(SonarQubeService);
  });

  it('ensureProject creates when search returns empty', async () => {
    httpService.get.mockReturnValue(of({ data: { components: [] } }));
    httpService.post.mockReturnValue(of({ data: {} }));

    const result = await service.ensureProject('group-repo_main', 'Repo (main)', 'main');

    expect(result).toEqual({ projectKey: 'group-repo_main', created: true });
    expect(httpService.post).toHaveBeenCalledWith(
      'http://sonarqube:9000/api/projects/create',
      null,
      expect.objectContaining({
        params: { project: 'group-repo_main', name: 'Repo (main)', main: 'main' },
      }),
    );
  });

  it('ensureProject skips create when project exists', async () => {
    httpService.get.mockReturnValue(of({ data: { components: [{ key: 'group-repo_main' }] } }));

    const result = await service.ensureProject('group-repo_main', 'Repo (main)');

    expect(result).toEqual({ projectKey: 'group-repo_main', created: false });
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('deleteProject calls delete API when project exists', async () => {
    httpService.get.mockReturnValue(of({ data: { components: [{ key: 'group-repo_main' }] } }));
    httpService.post.mockReturnValue(of({ data: {} }));

    await service.deleteProject('group-repo_main');

    expect(httpService.post).toHaveBeenCalledWith(
      'http://sonarqube:9000/api/projects/delete',
      null,
      expect.objectContaining({ params: { project: 'group-repo_main' } }),
    );
  });

  it('isConfigured is false without admin password', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SonarQubeService,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: createMockConfigService({
            'sonarqube.internalUrl': 'http://sonarqube:9000',
            'sonarqube.adminUser': 'admin',
            'sonarqube.adminPassword': undefined,
          }),
        },
      ],
    }).compile();

    expect(module.get(SonarQubeService).isConfigured()).toBe(false);
  });

  it('ensureProject throws when not configured', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SonarQubeService,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: createMockConfigService({
            'sonarqube.internalUrl': 'http://sonarqube:9000',
            'sonarqube.adminUser': undefined,
            'sonarqube.adminPassword': undefined,
          }),
        },
      ],
    }).compile();

    await expect(module.get(SonarQubeService).ensureProject('key', 'name')).rejects.toThrow(
      /not configured/i,
    );
  });

  it('generateGlobalAnalysisToken returns token from API', async () => {
    httpService.post.mockReturnValue(of({ data: { token: 'sqp_abc123' } }));

    const token = await service.generateGlobalAnalysisToken('dsoaas-gitlab-42');

    expect(token).toBe('sqp_abc123');
    expect(httpService.post).toHaveBeenCalledWith(
      'http://sonarqube:9000/api/user_tokens/generate',
      expect.stringContaining('GLOBAL_ANALYSIS_TOKEN'),
      expect.any(Object),
    );
  });

  it('ensureProject surfaces auth errors', async () => {
    httpService.get.mockReturnValue(
      throwError(() => ({ response: { status: 401, data: { errors: [] } } })),
    );

    await expect(service.ensureProject('key', 'name')).rejects.toThrow(/credentials/i);
  });
});
