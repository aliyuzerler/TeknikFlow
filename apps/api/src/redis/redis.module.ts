import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { getEnv } from '../config/env.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

function createRedisClient(): Redis {
  const env = getEnv();
  return new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    // Bağlantı yokken health endpoint'lerinin asılı kalmasını önle.
    connectTimeout: 2000,
    commandTimeout: 2000,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: createRedisClient,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
