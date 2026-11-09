import { Inject, Injectable, Logger } from '@nestjs/common';
import type { S3Client } from '@aws-sdk/client-s3';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { Redis } from 'ioredis';
import { computeReadiness, type ServiceCheckResult } from '@teknikflow/shared';
import { getEnv } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { S3_CLIENT } from '../storage/storage.module.js';

export interface ReadinessReport {
  status: 'ok' | 'degraded';
  checks: {
    database: ServiceCheckResult;
    redis: ServiceCheckResult;
    objectStorage: ServiceCheckResult;
  };
  version: string;
  timestamp: string;
}

const CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
  ) {}

  /** Süreç canlı mı? Bağımlılıklara bakmaz. */
  live(): { status: 'ok'; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /** Bağımlılıklar (DB, Redis, obje deposu) hazır mı? */
  async ready(): Promise<ReadinessReport> {
    const env = getEnv();
    const [database, redis, objectStorage] = await Promise.all([
      this.check('database', () => this.prisma.$queryRaw`SELECT 1`),
      this.check('redis', async () => {
        const pong = await this.redis.ping();
        if (pong !== 'PONG') {
          throw new Error(`beklenmeyen yanıt: ${pong}`);
        }
      }),
      this.check('objectStorage', () =>
        this.s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET })),
      ),
    ]);

    const { status } = computeReadiness({ database, redis, objectStorage });
    return {
      status,
      checks: { database, redis, objectStorage },
      version: env.APP_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  /** Tek bir kontrolü süre sınırıyla çalıştırır ve gecikmeyi ölçer. */
  private async check(
    name: string,
    probe: () => Promise<unknown>,
    timeoutMs: number = CHECK_TIMEOUT_MS,
  ): Promise<ServiceCheckResult> {
    const startedAt = performance.now();
    try {
      await withTimeout(probe(), timeoutMs, `${name} sağlık kontrolü zaman aşımı`);
      return { state: 'ok', latencyMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      // Sunucu tarafında tam hata loglanır; istemciye yalnızca güvenli özet gider.
      this.logger.error(`Sağlık kontrolü başarısız: ${name} → ${describe(error)}`);
      return { state: 'fail', error: safeSummary(error) };
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new TimeoutError(message)), ms);
    }),
  ]);
}

class TimeoutError extends Error {}

/** Hata özetinden kimlik bilgisi/DSN içerebilecek metinleri ayıklar. */
function safeSummary(error: unknown): string {
  if (error instanceof TimeoutError) {
    return 'zaman-asimi';
  }
  const candidate = isErrnoException(error) ? error.code : undefined;
  if (candidate) {
    return candidate;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return 'bilinmeyen-hata';
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
