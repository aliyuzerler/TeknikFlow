import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/common/configure-app.js';
import { resetEnvCache, getEnv } from '../../src/config/env.js';
import { REDIS_CLIENT } from '../../src/redis/redis.module.js';
import type { Redis } from 'ioredis';

/**
 * TEST-03 negatif yol — login uçlarında rate limit (429) davranışı.
 * Düşük limitli ayrı uygulama örneği: AUTH_RATE_LIMIT_MAX=3.
 */

let app: INestApplication;
let redis: Redis;

beforeAll(async () => {
  resetEnvCache();
  getEnv().AUTH_RATE_LIMIT_MAX = 3;
  getEnv().AUTH_RATE_LIMIT_WINDOW_SECONDS = 2;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  redis = app.get<Redis>(REDIS_CLIENT);
});

afterAll(async () => {
  await app.close();
});

describe('POST /auth/login — rate limit', () => {
  it('art arda başarısız denemeler pencere dolunca 429 üretir', async () => {
    // Kovayı temizle (önceki koşumlar).
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);

    const email = `ratelimit.${Date.now().toString(36)}@test.example`;
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPassword9' });

    // Limit 3: ilk 3 deneme 401 (genel hata), 4. → 429.
    for (let i = 0; i < 3; i += 1) {
      const response = await attempt();
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');

    // Farklı e-posta + aynı IP → IP kovası da dolu → yine 429.
    const other = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `other.${Date.now().toString(36)}@test.example`, password: 'WrongPassword9' });
    expect(other.status).toBe(429);
  });
});
