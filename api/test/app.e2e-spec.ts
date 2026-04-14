import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { createE2eApp } from './helpers/e2e-module';

interface ErrorResponseBody {
  statusCode: number;
  message: string;
  path: string;
  timestamp: string;
}

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createE2eApp());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return { status: "ok" }', () => {
      return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
    });
  });

  describe('GET /nonexistent', () => {
    it('should return 404 formatted by GlobalExceptionFilter', () => {
      return request(app.getHttpServer())
        .get('/nonexistent')
        .set('X-API-Key', 'test-api-key')
        .expect(404)
        .expect((res) => {
          const body = res.body as ErrorResponseBody;
          expect(body.statusCode).toBe(404);
          expect(body.path).toBe('/nonexistent');
          expect(typeof body.timestamp).toBe('string');
        });
    });
  });
});
