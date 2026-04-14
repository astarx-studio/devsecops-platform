import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from '../../src/app.controller';
import { GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { CombinedAuthGuard } from '../../src/common/guards/combined-auth.guard';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import { CloudflareService } from '../../src/cloudflare/cloudflare.service';
import { ConfigsController } from '../../src/configs/configs.controller';
import { ConfigsService } from '../../src/configs/configs.service';
import { GitLabService } from '../../src/gitlab/gitlab.service';
import { KongService } from '../../src/kong/kong.service';
import { ProjectsController } from '../../src/projects/projects.controller';
import { ProjectsService } from '../../src/projects/projects.service';
import { TemplatesController } from '../../src/templates/templates.controller';
import { TemplatesService } from '../../src/templates/templates.service';
import { VaultService } from '../../src/vault/vault.service';

/** Typed mock shape returned from createE2eApp, using jest.Mocked<T> for full IDE support. */
export interface E2eContext {
  app: INestApplication;
  gitlabService: jest.Mocked<GitLabService>;
  kongService: jest.Mocked<KongService>;
  vaultService: jest.Mocked<VaultService>;
  cloudflareService: jest.Mocked<CloudflareService>;
}

/**
 * Creates a fully wired NestJS application for e2e testing.
 *
 * All external services (GitLab, Kong, Vault, Cloudflare) are replaced
 * with jest mocks. The application uses the same validation pipe, global
 * filters, and interceptors as production, but with test config values.
 *
 * @returns {@link E2eContext} — the app instance and all mocked services
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

  const kongService = {
    registerService: jest.fn().mockResolvedValue({ serviceName: 'svc', hosts: [] }),
    removeService: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<KongService>;

  const vaultService = {
    writeSecrets: jest.fn().mockResolvedValue(undefined),
    deleteSecrets: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<VaultService>;

  const cloudflareService = {
    addDnsRecord: jest.fn().mockResolvedValue(true),
    removeDnsRecord: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<CloudflareService>;

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
            deployMode: 'local',
            apiKey: 'test-api-key',
            logLevel: 'error',
            gitlab: { url: 'http://gitlab', token: 'tok', templateGroupId: 10, configGroupId: 20 },
            kong: { adminUrl: 'http://kong:8001' },
            vault: { url: 'http://vault:8200', token: 'vtok' },
            cloudflare: {},
            deploy: {},
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
      { provide: KongService, useValue: kongService },
      { provide: VaultService, useValue: vaultService },
      { provide: CloudflareService, useValue: cloudflareService },
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

  return { app, gitlabService, kongService, vaultService, cloudflareService };
}
