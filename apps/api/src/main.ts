import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './common/configure-app.js';
import { getEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env.NODE_ENV === 'test' ? ['error', 'warn'] : ['log', 'error', 'warn'],
  });

  // Enine kesen kurulum (istek kimliği, CORS, hata zarfı) ortak kaynakta:
  // entegrasyon testleri de aynı configureApp'i çağırır.
  configureApp(app);

  await app.listen(env.PORT);
  new Logger('Bootstrap').log(
    `TeknikFlow API ${env.PORT} portunda dinliyor (NODE_ENV=${env.NODE_ENV})`,
  );
}

void bootstrap();
