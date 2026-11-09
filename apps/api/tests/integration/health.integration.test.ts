import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/common/configure-app.js';
import { HealthLiveResponseSchema, HealthReadyResponseSchema } from '@teknikflow/contracts';

// Entegrasyon: GERÇEK yerel altyapı (PostgreSQL + Redis + RustFS) gerektirir.
// Bilinçli atlamak için: RUN_INTEGRATION=false
const maybeDescribe = process.env.RUN_INTEGRATION === 'false' ? describe.skip : describe;

// Test veritabanı ayrıysa burada devreye girer (CI: teknikflow_test).
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

maybeDescribe('GET /health (entegrasyon — gerçek bağımlılıklar)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Üretimle birebir aynı enine kesen kurulum (requestId, CORS, hata zarfı).
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live → 200 + sözleşme doğrulu', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.headers['x-request-id']).toBeTruthy();
    const parsed = HealthLiveResponseSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);
  });

  it('GET /health/ready → 200, tüm bağımlılıklar ok', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
    const parsed = HealthReadyResponseSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('ok');
      expect(parsed.data.checks.database.state).toBe('ok');
      expect(parsed.data.checks.redis.state).toBe('ok');
      expect(parsed.data.checks.objectStorage.state).toBe('ok');
    }
  });

  it('bilinmeyen yol → 404 + hata zarfı (requestId ile)', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/henüz-yok').expect(404);
    expect(response.body).toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    expect(typeof response.body.requestId).toBe('string');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });
});
