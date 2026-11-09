import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ErrorEnvelopeFilter } from './error-envelope.filter.js';
import { getEnv, newRequestId } from '../config/env.js';

/**
 * Uygulama düzeyi enine kesen kaygılar (istek kimliği, CORS, hata zarfı,
 * zarif kapanış) — main.ts ve entegrasyon testleri AYNI kurulumu kullanır;
 * böylece test edilen yüzey üretime birebir eşittir.
 */
export function configureApp(app: INestApplication): void {
  const env = getEnv();

  // İstek izleme başlığı: loglar ve hata zarfları aynı kimliği taşır.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-request-id', newRequestId());
    next();
  });

  app.enableCors({
    origin: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  app.useGlobalFilters(new ErrorEnvelopeFilter());
  app.enableShutdownHooks();
}
