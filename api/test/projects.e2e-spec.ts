import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { GitLabService } from '../src/gitlab/gitlab.service';
import { createE2eApp } from './helpers/e2e-module';
import { gitlabProjectFactory } from './helpers/factories';

/** Valid MongoDB ObjectId string used by the e2e Project model mock. */
const SAMPLE_PROJECT_MONGO_ID = '507f191e810c19729de860ea';

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
    it('should return 410 Gone (writes use GraphQL)', () => {
      return request(app.getHttpServer())
        .post('/projects')
        .set('X-API-Key', API_KEY)
        .send({
          clientName: 'acme',
          projectName: 'webapp',
          templateSlug: 'nestjs-app',
        })
        .expect(410)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body).toHaveProperty('graphqlEndpoint', '/graphql');
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
  });

  describe('GET /projects', () => {
    it('should return array of projects from MongoDB', () => {
      return request(app.getHttpServer())
        .get('/projects')
        .set('X-API-Key', API_KEY)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body as unknown[])).toBe(true);
          expect((res.body as unknown[]).length).toBeGreaterThanOrEqual(1);
          const first = (res.body as { gitlabProjectId: number }[])[0];
          expect(first.gitlabProjectId).toBe(42);
        });
    });
  });

  describe('GET /projects/:id', () => {
    it('should return a project by MongoDB ID', () => {
      return request(app.getHttpServer())
        .get(`/projects/${SAMPLE_PROJECT_MONGO_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(200)
        .expect((res) => {
          const body = res.body as { id: string; gitlabProjectId: number };
          expect(body.id).toBe(SAMPLE_PROJECT_MONGO_ID);
          expect(body.gitlabProjectId).toBe(42);
        });
    });

    it('should return 404 when project not found', () => {
      return request(app.getHttpServer())
        .get('/projects/64a1b2c3d4e5f6789012345')
        .set('X-API-Key', API_KEY)
        .expect(404);
    });
  });

  describe('DELETE /projects/:id', () => {
    it('should return 410 Gone (writes use GraphQL)', () => {
      return request(app.getHttpServer())
        .delete(`/projects/${SAMPLE_PROJECT_MONGO_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(410);
    });
  });
});
