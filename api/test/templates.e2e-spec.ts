import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { GitLabService } from '../src/gitlab/gitlab.service';
import { createE2eApp } from './helpers/e2e-module';
import { gitlabProjectFactory, gitlabTreeItemFactory } from './helpers/factories';

interface TemplateResponseBody {
  id: number;
  slug: string;
  description?: string;
  files?: unknown[];
}

describe('Templates (e2e)', () => {
  let app: INestApplication<App>;
  let gitlabService: jest.Mocked<GitLabService>;

  const API_KEY = 'test-api-key';

  const templateProject = gitlabProjectFactory({
    id: 10,
    name: 'nestjs-app',
    description: 'NestJS starter',
    web_url: 'https://gitlab.test/templates/nestjs-app',
    default_branch: 'main',
    last_activity_at: '2026-01-01T00:00:00Z',
  });

  beforeAll(async () => {
    ({ app, gitlabService } = await createE2eApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    gitlabService.listProjects.mockResolvedValue([templateProject]);
  });

  describe('GET /templates', () => {
    it('should return list of templates', () => {
      return request(app.getHttpServer())
        .get('/templates')
        .set('X-API-Key', API_KEY)
        .expect(200)
        .expect((res) => {
          const body = res.body as TemplateResponseBody[];
          expect(Array.isArray(body)).toBe(true);
          expect(body).toHaveLength(1);
          expect(body[0].slug).toBe('nestjs-app');
        });
    });
  });

  describe('GET /templates/:slug', () => {
    it('should return template detail with file tree', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(templateProject);
      gitlabService.getProjectTree.mockResolvedValueOnce([
        gitlabTreeItemFactory({ name: 'src', type: 'tree', path: 'src' }),
      ]);

      return request(app.getHttpServer())
        .get('/templates/nestjs-app')
        .set('X-API-Key', API_KEY)
        .expect(200)
        .expect((res) => {
          const body = res.body as TemplateResponseBody;
          expect(body.slug).toBe('nestjs-app');
          expect(body.files).toHaveLength(1);
        });
    });

    it('should return 404 when template not found', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(undefined);

      return request(app.getHttpServer())
        .get('/templates/nonexistent')
        .set('X-API-Key', API_KEY)
        .expect(404);
    });
  });

  describe('POST /templates', () => {
    it('should create a new template and return 201', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(undefined);
      gitlabService.createNewProject.mockResolvedValueOnce(templateProject);

      return request(app.getHttpServer())
        .post('/templates')
        .set('X-API-Key', API_KEY)
        .send({ slug: 'nestjs-app', description: 'NestJS starter' })
        .expect(201)
        .expect((res) => {
          const body = res.body as TemplateResponseBody;
          expect(body.slug).toBe('nestjs-app');
        });
    });

    it('should return 400 with invalid slug', () => {
      return request(app.getHttpServer())
        .post('/templates')
        .set('X-API-Key', API_KEY)
        .send({ slug: '-invalid-' })
        .expect(400);
    });

    it('should return 409 when template already exists', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(templateProject);

      return request(app.getHttpServer())
        .post('/templates')
        .set('X-API-Key', API_KEY)
        .send({ slug: 'nestjs-app' })
        .expect(409);
    });
  });

  describe('DELETE /templates/:slug', () => {
    it('should return 204 on successful delete', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(templateProject);

      return request(app.getHttpServer())
        .delete('/templates/nestjs-app')
        .set('X-API-Key', API_KEY)
        .expect(204);
    });

    it('should return 404 when template not found', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(undefined);

      return request(app.getHttpServer())
        .delete('/templates/missing')
        .set('X-API-Key', API_KEY)
        .expect(404);
    });
  });
});
