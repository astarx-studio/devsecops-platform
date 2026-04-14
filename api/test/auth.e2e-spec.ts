import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { createE2eApp } from './helpers/e2e-module';

interface ErrorResponseBody {
  statusCode: number;
  message: string;
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createE2eApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('should allow access with valid API key', () => {
    return request(app.getHttpServer())
      .get('/projects')
      .set('X-API-Key', 'test-api-key')
      .expect(200);
  });

  it('should reject request without any credentials', () => {
    return request(app.getHttpServer())
      .get('/projects')
      .expect(401)
      .expect((res) => {
        const body = res.body as ErrorResponseBody;
        expect(body.message).toContain('Authentication required');
      });
  });

  it('should reject request with invalid API key', () => {
    return request(app.getHttpServer())
      .get('/projects')
      .set('X-API-Key', 'wrong-key')
      .expect(401)
      .expect((res) => {
        const body = res.body as ErrorResponseBody;
        expect(body.message).toContain('Invalid API key');
      });
  });

  it('should return 401 for all protected endpoints without auth', async () => {
    const endpoints = [
      { method: 'get' as const, url: '/projects' },
      { method: 'post' as const, url: '/projects' },
      { method: 'get' as const, url: '/templates' },
      { method: 'post' as const, url: '/templates' },
      { method: 'get' as const, url: '/configs' },
      { method: 'post' as const, url: '/configs' },
    ];

    for (const { method, url } of endpoints) {
      const res = await request(app.getHttpServer())[method](url);
      expect(res.status).toBe(401);
    }
  });
});
