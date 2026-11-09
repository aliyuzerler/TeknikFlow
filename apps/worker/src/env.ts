import { existsSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const WorkerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().min(1, 'zorunlu'),
  WORKER_PORT: z.coerce.number().int().positive().default(4001),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  HEARTBEAT_MAX_AGE_MS: z.coerce.number().int().positive().default(90000),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function parseWorkerEnv(raw: Record<string, string | undefined>): WorkerEnv {
  const result = WorkerEnvSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(kök)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Geçersiz worker ortamı → ${details}`);
  }
  return result.data;
}

let cached: WorkerEnv | undefined;

export function getWorkerEnv(): WorkerEnv {
  if (!cached) {
    // src/env ve dist/env aynı derinlikte; kök .env tek kaynaktır.
    // override: sandbox/CI'da çakışan süreç değişkenlerini geliştirme
    // değerleri yener; .env yoksa gerçek ortam değişkenleri kalır.
    for (const candidate of [
      join(__dirname, '../../../../.env'),
      join(process.cwd(), '../../.env'),
      join(process.cwd(), '.env'),
    ]) {
      if (existsSync(candidate)) {
        dotenv.config({ path: candidate, override: true });
      }
    }
    cached = parseWorkerEnv(process.env);
  }
  return cached;
}

export function resetWorkerEnvCache(): void {
  cached = undefined;
}
