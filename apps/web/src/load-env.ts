import { existsSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';

/**
 * Kök .env dosyasını (tek geliştirme ortamı kaynağı) yükler.
 * next dev yalnızca apps/web/.env*'e bakar; biz tek kaynak repo kökünde tutuyoruz.
 */
export function loadRootEnv(): void {
  const candidates = [
    join(process.cwd(), '../../.env'), // apps/web çalışma dizininden repo kökü
    join(process.cwd(), '.env'),
    join(process.cwd(), '../.env'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      // override: geliştirme .env'i çakışan süreç değişkenlerini yener;
      // dosya yoksa (CI/üretim) gerçek ortam değişkenleri kalır.
      dotenv.config({ path: candidate, override: true });
    }
  }
}

export function getWebEnv(): { apiBaseUrl: string; workerHealthUrl: string } {
  loadRootEnv();
  return {
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000',
    workerHealthUrl: process.env.WORKER_HEALTH_URL ?? 'http://localhost:4001/health',
  };
}
