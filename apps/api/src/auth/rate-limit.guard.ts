import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { Redis } from 'ioredis';
import { getEnv } from '../config/env.js';

/**
 * Faz 03 — kimlik uçlarında rate limit (SECURITY_PRIVACY.md).
 *
 * Sabit pencere, iki kova: IP başına ve kimlik (e-posta sha256) başına.
 * E-posta açık metin olarak Redis'e YAZILMAZ (PII minimize).
 * Limit aşımı → 429 RATE_LIMITED (mesaj genel).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly max: number;
  private readonly windowSeconds: number;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    const env = getEnv();
    this.max = env.AUTH_RATE_LIMIT_MAX;
    this.windowSeconds = env.AUTH_RATE_LIMIT_WINDOW_SECONDS;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { body?: Record<string, unknown> }>();
    const scope = this.reflectorScope(request);

    const ip = clientIp(request);
    const buckets: Array<{ key: string }> = [{ key: `rl:${scope}:ip:${ip}` }];

    const email = typeof request.body?.email === 'string' ? request.body.email : undefined;
    if (email) {
      const emailHash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
      buckets.push({ key: `rl:${scope}:em:${emailHash}` });
    }

    for (const { key } of buckets) {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, this.windowSeconds);
      }
      if (count > this.max) {
        throw new HttpException(
          {
            message: 'Çok fazla deneme — lütfen bir süre sonra tekrar deneyin',
            code: 'RATE_LIMITED',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }

  private reflectorScope(request: Request): string {
    // Uç bazlı kapsam: yol adından türetilir (auth/login, auth/signup, davet kabulü).
    const rawPath: string = request.route?.path ?? request.url ?? '';
    const path = rawPath.replace(/[^a-z0-9]+/gi, ':').slice(0, 60);
    return path || 'auth';
  }
}

function clientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return (forwarded.split(',')[0] ?? forwarded).trim().slice(0, 64);
  }
  return (request.ip ?? 'unknown').slice(0, 64);
}
