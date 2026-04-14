import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { GitLabService } from '../src/gitlab/gitlab.service';
import { createE2eApp } from './helpers/e2e-module';
import { gitlabProjectFactory } from './helpers/factories';

interface ProjectResponseBody {
  id: number;
  name: string;
  clientName: string;
  vaultPath: string;
}

describe('Projects (e2e)', () => {
  let app: INestApplication<App>;
  let gitlabService: jest.Mocked<GitLabService>;

  const API_KEY = 'test-api-key';

  const forkedProject = gitlabProjectFactory({
    id: 42,
    name: 'webapp',
    path_with_namespace: 'clients/acme/webapp',
    web_url: 'https://gitlab.devops.test.net/clients/acme/webapp',
  });

  beforeAll(async () => {
    ({ app, gitlabService } = await createE2eApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    gitlabService.forkTemplate.mockResolvedValue(forkedProject);
    gitlabService.getProject.mockResolvedValue(forkedProject);
    gitlabService.listProjects.mockResolvedValue([forkedProject]);
  });

  describe('POST /projects', () => {
    it('should create a project and return 201', () => {
      return request(app.getHttpServer())
        .post('/projects')
        .set('X-API-Key', API_KEY)
        .send({
          clientName: 'acme',
          projectName: 'webapp',
          templateSlug: 'nestjs-app',
        })
        .expect(201)
        .expect((res) => {
          const body = res.body as ProjectResponseBody;
          expect(body.id).toBe(42);
          expect(body.name).toBe('webapp');
          expect(body.clientName).toBe('acme');
          expect(body.vaultPath).toBe('projects/acme/webapp');
        });
    });

    it('should return 401 without auth', () => {
      return request(app.getHttpServer())
        .post('/projects')
        .send({
          clientName: 'acme',
          projectName: 'webapp',
          templateSlug: 'nestjs-app',
        })
        .expect(401);
    });

    it('should return 400 with invalid body (missing required fields)', () => {
      return request(app.getHttpServer())
        .post('/projects')
        .set('X-API-Key', API_KEY)
        .send({ clientName: 'acme' })
        .expect(400);
    });

    it('should return 400 with invalid clientName format', () => {
      return request(app.getHttpServer())
        .post('/projects')
        .set('X-API-Key', API_KEY)
        .send({
          clientName: 'INVALID_NAME',
          projectName: 'webapp',
          templateSlug: 'nestjs-app',
        })
        .expect(400);
    });

    it('should return 400 with non-whitelisted properties', () => {
      return request(app.getHttpServer())
        .post('/projects')
        .set('X-API-Key', API_KEY)
        .send({
          clientName: 'acme',
          projectName: 'webapp',
          templateSlug: 'nestjs-app',
          unknownField: 'should-fail',
        })
        .expect(400);
    });
  });

  describe('GET /projects', () => {
    it('should return array of projects', () => {
      return request(app.getHttpServer())
        .get('/projects')
        .set('X-API-Key', API_KEY)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body as unknown[])).toBe(true);
          expect((res.body as unknown[]).length).toBe(1);
        });
    });
  });

  describe('GET /projects/:id', () => {
    it('should return a project by ID', () => {
      return request(app.getHttpServer())
        .get('/projects/42')
        .set('X-API-Key', API_KEY)
        .expect(200)
        .expect((res) => {
          const body = res.body as ProjectResponseBody;
          expect(body.id).toBe(42);
        });
    });

    it('should return 400 for non-numeric ID', () => {
      return request(app.getHttpServer())
        .get('/projects/abc')
        .set('X-API-Key', API_KEY)
        .expect(400);
    });
  });

  describe('DELETE /projects/:id', () => {
    it('should return 204 on successful delete', () => {
      return request(app.getHttpServer())
        .delete('/projects/42')
        .set('X-API-Key', API_KEY)
        .expect(204);
    });
  });
});
