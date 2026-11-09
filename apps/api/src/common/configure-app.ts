import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ErrorEnvelopeFilter } from './error-envelope.filter.js';
import { csrfProtection } from '../auth/csrf.middleware.js';
import { getEnv, newRequestId } from '../config/env.js';

/**
 * Uygulama düzeyi enine kesen kaygılar (istek kimliği, CORS, API öneki,
 * CSRF, hata zarfı, zarif kapanış) — main.ts ve entegrasyon testleri
 * AYNI kurulumu kullanır; böylece test edilen yüzey üretime birebir eşittir.
 *
 * Sürüm öneki: iş uçları /api/v1 altındadır (docs/API_CONVENTIONS.md).
 * Sağlık uçları (/health/*) kasten önek DIŞIDIR: altyapı yoklamaları
 * sürümlemeden bağımsız kalır (Faz 01 sözleşmesi korunur).
 */
export function configureApp(app: INestApplication): void {
  const env = getEnv();

  // İstek izleme başlığı: loglar ve hata zarfları aynı kimliği taşır.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-request-id', newRequestId());
    next();
  });

  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });

  app.enableCors({
    origin: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    credentials: true,
  });

  // Faz 03: çerezli oturumlar için CSRF (çift-gönderim + Origin).
  app.use(csrfProtection);

  app.useGlobalFilters(new ErrorEnvelopeFilter());
  app.enableShutdownHooks();
}
