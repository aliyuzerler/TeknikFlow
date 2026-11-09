import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Ortam değişkenleri API sınırında Zod ile doğrulanır.
 * Eksik/hatalı değer varsa süreç başlamaz — sessiz varsayılan yok.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'zorunlu'),
  REDIS_URL: z.string().min(1, 'zorunlu'),
  S3_ENDPOINT: z.string().min(1, 'zorunlu'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1, 'zorunlu'),
  S3_ACCESS_KEY: z.string().min(1, 'zorunlu'),
  S3_SECRET_KEY: z.string().min(1, 'zorunlu'),
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  APP_VERSION: z.string().default('0.1.0'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
});

export type Env = z.infer<typeof EnvSchema>;

/** Saf ayrıştırıcı — birim testleri doğrudan bunu sınar. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(kök)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Geçersiz ortam değişkenleri → ${details}`);
  }
  return result.data;
}

let cachedEnv: Env | undefined;

/** Kök .env'den (geliştirme) yükleyip doğrulanmış ortamı döndürür. */
export function getEnv(): Env {
  if (!cachedEnv) {
    // tsx (src/config) ve derlenmiş (dist/config) dizin yapıları aynı derinliktedir.
    // override: geliştirme .env'i süreç ortamındaki bayat/çakışan değerleri
    // (ör. sandbox'ın DATABASE_URL'ü) bilinçli olarak yener; CI/üretimde .env
    // dosyası bulunmadığından gerçek ortam değişkenleri geçerli kalır.
    for (const candidate of [
      join(__dirname, '../../../../.env'),
      join(process.cwd(), '../../.env'),
      join(process.cwd(), '.env'),
    ]) {
      if (existsSync(candidate)) {
        dotenv.config({ path: candidate, override: true });
      }
    }
    cachedEnv = parseEnv(process.env);
  }
  return cachedEnv;
}

/** Testler için memoizasyonu sıfırlar. */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}

/** İstek izleme için kısa kimlik. */
export function newRequestId(): string {
  return randomUUID();
}
