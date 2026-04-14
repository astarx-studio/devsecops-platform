import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { GitLabService } from '../src/gitlab/gitlab.service';
import { createE2eApp } from './helpers/e2e-module';
import { gitlabProjectFactory, gitlabTreeItemFactory } from './helpers/factories';

interface ConfigResponseBody {
  id: number;
  slug: string;
  description?: string;
  files?: unknown[];
}

describe('Configs (e2e)', () => {
  let app: INestApplication<App>;
  let gitlabService: jest.Mocked<GitLabService>;

  const API_KEY = 'test-api-key';

  const configProject = gitlabProjectFactory({
    id: 20,
    name: 'node-pipeline',
    description: 'Node CI',
    web_url: 'https://gitlab.test/configs/node-pipeline',
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
    gitlabService.listProjects.mockResolvedValue([configProject]);
  });

  describe('GET /configs', () => {
    it('should return list of configs', () => {
      return request(app.getHttpServer())
        .get('/configs')
        .set('X-API-Key', API_KEY)
        .expect(200)
        .expect((res) => {
          const body = res.body as ConfigResponseBody[];
          expect(Array.isArray(body)).toBe(true);
          expect(body).toHaveLength(1);
          expect(body[0].slug).toBe('node-pipeline');
        });
    });
  });

  describe('GET /configs/:slug', () => {
    it('should return config detail with file tree', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(configProject);
      gitlabService.getProjectTree.mockResolvedValueOnce([
        gitlabTreeItemFactory({ name: '.gitlab-ci.yml', path: '.gitlab-ci.yml', type: 'blob' }),
      ]);

      return request(app.getHttpServer())
        .get('/configs/node-pipeline')
        .set('X-API-Key', API_KEY)
        .expect(200)
        .expect((res) => {
          const body = res.body as ConfigResponseBody;
          expect(body.slug).toBe('node-pipeline');
          expect(body.files).toHaveLength(1);
        });
    });

    it('should return 404 when config not found', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(undefined);

      return request(app.getHttpServer())
        .get('/configs/nonexistent')
        .set('X-API-Key', API_KEY)
        .expect(404);
    });
  });

  describe('POST /configs', () => {
    it('should create a new config and return 201', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(undefined);
      gitlabService.createNewProject.mockResolvedValueOnce(configProject);

      return request(app.getHttpServer())
        .post('/configs')
        .set('X-API-Key', API_KEY)
        .send({
          slug: 'node-pipeline',
          description: 'Node CI',
          ciContent: '.lint:\n  script: pnpm lint\n',
        })
        .expect(201)
        .expect((res) => {
          const body = res.body as ConfigResponseBody;
          expect(body.slug).toBe('node-pipeline');
        });
    });

    it('should return 400 with missing ciContent', () => {
      return request(app.getHttpServer())
        .post('/configs')
        .set('X-API-Key', API_KEY)
        .send({ slug: 'node-pipeline' })
        .expect(400);
    });

    it('should return 409 when config already exists', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(configProject);

      return request(app.getHttpServer())
        .post('/configs')
        .set('X-API-Key', API_KEY)
        .send({ slug: 'node-pipeline', ciContent: 'content' })
        .expect(409);
    });
  });

  describe('PUT /configs/:slug/files', () => {
    it('should update files and return 204', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(configProject);

      return request(app.getHttpServer())
        .put('/configs/node-pipeline/files')
        .set('X-API-Key', API_KEY)
        .send({
          filePath: '.gitlab-ci.yml',
          content: 'updated content',
          commitMessage: 'chore: update CI',
        })
        .expect(204);
    });

    it('should return 404 when config not found', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(undefined);

      return request(app.getHttpServer())
        .put('/configs/missing/files')
        .set('X-API-Key', API_KEY)
        .send({
          filePath: '.gitlab-ci.yml',
          content: 'content',
          commitMessage: 'msg',
        })
        .expect(404);
    });

    it('should return 400 with missing required fields', () => {
      return request(app.getHttpServer())
        .put('/configs/node-pipeline/files')
        .set('X-API-Key', API_KEY)
        .send({ filePath: '.gitlab-ci.yml' })
        .expect(400);
    });
  });

  describe('DELETE /configs/:slug', () => {
    it('should return 204 on successful delete', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(configProject);

      return request(app.getHttpServer())
        .delete('/configs/node-pipeline')
        .set('X-API-Key', API_KEY)
        .expect(204);
    });

    it('should return 404 when config not found', () => {
      gitlabService.findProjectInGroupPublic.mockResolvedValueOnce(undefined);

      return request(app.getHttpServer())
        .delete('/configs/missing')
        .set('X-API-Key', API_KEY)
        .expect(404);
    });
  });
});
