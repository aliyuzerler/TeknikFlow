import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthService } from './health.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Redis } from 'ioredis';
import type { S3Client } from '@aws-sdk/client-s3';
import { resetEnvCache } from '../config/env.js';

// Birim testleri getEnv() için gerekli asgari ortamı sağlar (canlı bağlantı YOK).
const ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
] as const;

beforeAll(() => {
  for (const key of ENV_KEYS) {
    process.env[key] ??= `unit-test-placeholder-${key.toLowerCase()}`;
  }
  resetEnvCache();
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (process.env[key]?.startsWith('unit-test-placeholder-')) {
      delete process.env[key];
    }
  }
  resetEnvCache();
});

interface Harness {
  service: HealthService;
  prisma: Pick<PrismaService, '$queryRaw'>;
  redis: Pick<Redis, 'ping'>;
  s3: Pick<S3Client, 'send'>;
}

function createHarness(overrides: {
  prisma?: () => Promise<unknown>;
  redis?: () => Promise<unknown>;
  s3?: () => Promise<unknown>;
}): Harness {
  const prisma = {
    $queryRaw: overrides.prisma ?? (async () => [{ ok: 1 }]),
  } as unknown as Pick<PrismaService, '$queryRaw'>;
  const redis = { ping: overrides.redis ?? (async () => 'PONG') } as unknown as Pick<Redis, 'ping'>;
  const s3 = { send: overrides.s3 ?? (async () => ({})) } as unknown as Pick<S3Client, 'send'>;
  const service = new HealthService(
    prisma as PrismaService,
    redis as unknown as Redis,
    s3 as unknown as S3Client,
  );
  return { service, prisma, redis, s3 };
}

describe('HealthService.ready', () => {
  it('tüm bağımlılıklar ayakta ise status=ok ve gecikmeler dolu', async () => {
    const { service } = createHarness({});
    const report = await service.ready();
    expect(report.status).toBe('ok');
    expect(report.checks.database).toMatchObject({ state: 'ok' });
    expect(report.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(report.checks.redis).toMatchObject({ state: 'ok' });
    expect(report.checks.objectStorage).toMatchObject({ state: 'ok' });
    expect(report.version).toBe('0.1.0');
    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
  });

  it('Redis düşükse degraded ve güvenli hata özeti döner', async () => {
    const { service } = createHarness({
      redis: async () => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:6379') as NodeJS.ErrnoException;
        error.code = 'ECONNREFUSED';
        throw error;
      },
    });
    const report = await service.ready();
    expect(report.status).toBe('degraded');
    expect(report.checks.redis.state).toBe('fail');
    expect(report.checks.redis.error).toBe('ECONNREFUSED');
    expect(report.checks.redis.error).not.toContain('127.0.0.1');
  });

  it('yanlış PONG yanıtı hata sayılır', async () => {
    const { service } = createHarness({ redis: async () => 'WRONG' });
    const report = await service.ready();
    expect(report.status).toBe('degraded');
    expect(report.checks.redis.state).toBe('fail');
  });

  it('veritabanı hatası degraded döner, hata adı sızar (kod yoksa)', async () => {
    const { service } = createHarness({
      prisma: async () => {
        throw new Error('connection refused');
      },
    });
    const report = await service.ready();
    expect(report.checks.database.state).toBe('fail');
    expect(report.checks.database.error).toBe('Error');
    expect(report.checks.database.error).not.toContain('connection refused');
  });

  it('asılı kalan bağımlılık zaman aşımıyla fail olur', async () => {
    const { service } = createHarness({
      s3: () => new Promise(() => undefined), // asla çözülmeyen promise
    });
    const report = await service.ready();
    expect(report.checks.objectStorage.state).toBe('fail');
    expect(report.checks.objectStorage.error).toBe('zaman-asimi');
  }, 10000);
});

describe('HealthService.live', () => {
  it('süreç canlılık verisi döner', () => {
    const { service } = createHarness({});
    const live = service.live();
    expect(live.status).toBe('ok');
    expect(live.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(live.timestamp))).toBe(false);
  });
});
