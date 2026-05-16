import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from '../../src/app.controller';
import { GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { CombinedAuthGuard } from '../../src/common/guards/combined-auth.guard';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import { ConfigsController } from '../../src/configs/configs.controller';
import { ConfigsService } from '../../src/configs/configs.service';
import { GitLabService } from '../../src/gitlab/gitlab.service';
import { K8sService } from '../../src/k8s/k8s.service';
import { ProjectsController } from '../../src/projects/projects.controller';
import { ProjectsService } from '../../src/projects/projects.service';
import { SlugService } from '../../src/projects/slug.service';
import { AuditLog } from '../../src/projects/schemas/audit-log.schema';
import { Project } from '../../src/projects/schemas/project.schema';
import { TemplatesController } from '../../src/templates/templates.controller';
import { TemplatesService } from '../../src/templates/templates.service';
import { VaultService } from '../../src/vault/vault.service';

/** Typed mock shape returned from createE2eApp. */
export interface E2eContext {
  app: INestApplication;
  gitlabService: jest.Mocked<GitLabService>;
  vaultService: jest.Mocked<VaultService>;
}

/** Matches `projects.e2e-spec.ts` SAMPLE_PROJECT_MONGO_ID for GET-by-id. */
const E2E_SAMPLE_PROJECT_DOC = {
  _id: '507f191e810c19729de860ea',
  gitlabProjectId: 42,
  gitlabPath: 'clients/acme/webapp',
  groupPath: ['clients', 'acme'],
  projectSlug: 'webapp',
  effectiveSlug: 'webapp',
  vaultBasePath: 'projects/clients/acme/webapp',
  helmReleaseName: 'webapp',
  provisioning: 'auto-devops' as const,
  capabilities: { deployable: true, publishable: false },
  appHosts: { dev: 'webapp.dev.apps.test.net' },
  legacyV1: false,
  pinnedV1: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  save: jest.fn().mockResolvedValue(undefined),
  deleteOne: jest.fn().mockResolvedValue(undefined),
};

function createE2eProjectModelMock() {
  const mockDoc = {
    _id: 'mock-doc-id',
    save: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest.fn().mockResolvedValue(undefined),
  };

  return {
    find: jest.fn().mockReturnValue({
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([E2E_SAMPLE_PROJECT_DOC]),
    }),
    findOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    }),
    findById: jest.fn().mockImplementation((id: { toString(): string } | string) => ({
      exec: jest
        .fn()
        .mockResolvedValue(
          String(id) === E2E_SAMPLE_PROJECT_DOC._id ? E2E_SAMPLE_PROJECT_DOC : null,
        ),
    })),
    countDocuments: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    }),
    create: jest.fn().mockResolvedValue(mockDoc),
  };
}

function createE2eAuditLogModelMock() {
  return {
    create: jest.fn().mockResolvedValue({}),
  };
}

/**
 * Creates a fully wired NestJS application for e2e testing.
 *
 * External services (GitLab, Vault, Kubernetes, Mongo models) are replaced with jest mocks.
 *
 * @returns {@link E2eContext} — the app instance and mocked services
 */
export async function createE2eApp(): Promise<E2eContext> {
  const gitlabService = {
    createGroupHierarchy: jest.fn().mockResolvedValue(5),
    forkTemplate: jest.fn(),
    listProjects: jest.fn().mockResolvedValue([]),
    getProject: jest.fn(),
    deleteProject: jest.fn().mockResolvedValue(undefined),
    triggerPipeline: jest.fn().mockResolvedValue(undefined),
    getFileContent: jest.fn().mockResolvedValue(null),
    upsertFile: jest.fn().mockResolvedValue(undefined),
    createNewProject: jest.fn(),
    getProjectTree: jest.fn().mockResolvedValue([]),
    findProjectInGroupPublic: jest.fn().mockResolvedValue(undefined),
    templateGroup: 10,
    configGroup: 20,
  } as unknown as jest.Mocked<GitLabService>;

  const vaultService = {
    writeSecrets: jest.fn().mockResolvedValue(undefined),
    deleteSecrets: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<VaultService>;

  const k8sService = {
    ensureNamespace: jest.fn().mockResolvedValue(undefined),
    getKubeconfigB64: jest.fn().mockReturnValue('dGVzdA=='),
  };

  const slugService = {
    resolve: jest.fn().mockImplementation((requested: string) => Promise.resolve(requested)),
    isAvailable: jest.fn().mockResolvedValue(true),
  };

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          () => ({
            port: 3000,
            host: '0.0.0.0',
            domain: 'test.net',
            appsDomain: 'apps.test.net',
            apiKey: 'test-api-key',
            logLevel: 'error',
            gitlab: { url: 'http://gitlab', token: 'tok', templateGroupId: 10, configGroupId: 20 },
            mongo: { url: 'mongodb://mongo:27017', dbName: 'platform' },
            vault: { url: 'http://vault:8200', token: 'vtok' },
            kube: { configDir: '/tmp/kubeconfigs' },
            autoDevops: {
              pipelineProject: 'system/devsecops-platform/configs/auto-devops-pipeline',
              pipelineFile: '.gitlab-ci.yml',
            },
            oidc: {},
          }),
        ],
      }),
    ],
    controllers: [AppController, ProjectsController, TemplatesController, ConfigsController],
    providers: [
      ProjectsService,
      TemplatesService,
      ConfigsService,
      CombinedAuthGuard,
      { provide: GitLabService, useValue: gitlabService },
      { provide: VaultService, useValue: vaultService },
      { provide: K8sService, useValue: k8sService },
      { provide: SlugService, useValue: slugService },
      { provide: getModelToken(Project.name), useValue: createE2eProjectModelMock() },
      { provide: getModelToken(AuditLog.name), useValue: createE2eAuditLogModelMock() },
      { provide: getConnectionToken(), useValue: { readyState: 1 } },
    ],
  }).compile();

  const app: INestApplication = moduleFixture.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.init();

  return { app, gitlabService, vaultService };
}
