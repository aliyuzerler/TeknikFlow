import type { NextFunction, Request, Response } from 'express';
import { HttpException, HttpStatus } from '@nestjs/common';
import { getEnv } from '../config/env.js';
import { readCookie } from '../auth/auth.guard.js';

/**
 * Faz 03 — CSRF middleware'i (ADR-0002: web çerezli oturumlar).
 *
 * Çift-gönderim deseni + Origin denetimi:
 * - Güvensiz fiiller (POST/PATCH/PUT/DELETE) ve `tf_session` çerezi varsa:
 *   `x-csrf-token` başlığı ile `tf_csrf` çerezi eşleşmeli (şemaya
 *   bağlama AuthGuard'da oturum kaydıyla doğrulanır).
 * - Origin/Referer başlığı varsa izinli kökenler içinde olmalı.
 * - Authorization: Bearer taşıyan istekler (mobil) muaf — çerez yok, CSRF
 *   tehdit modeli dışı.
 *
 * Oturum gerektirmeyen uçlarda (login/signup) çerez yok → muafiyet doğal;
 * o uçlar RateLimitGuard ile korunur.
 */

const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (!UNSAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (
    typeof req.headers.authorization === 'string' &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    next();
    return;
  }

  const sessionCookie = readCookie(req.headers.cookie, 'tf_session');
  if (!sessionCookie) {
    next();
    return;
  }

  const csrfCookie = readCookie(req.headers.cookie, 'tf_csrf');
  const csrfHeader = req.headers['x-csrf-token'];
  const headerValue = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

  if (!csrfCookie || typeof headerValue !== 'string' || csrfCookie !== headerValue) {
    next(
      new HttpException(
        { message: 'CSRF doğrulaması başarısız', code: 'CSRF_INVALID' },
        HttpStatus.FORBIDDEN,
      ),
    );
    return;
  }

  const env = getEnv();
  const allowedOrigins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const origin = req.headers.origin ?? req.headers.referer;
  if (typeof origin === 'string' && origin.length > 0 && !allowedOrigins.includes(origin)) {
    next(
      new HttpException(
        { message: 'İstek kökeni reddedildi', code: 'CSRF_ORIGIN' },
        HttpStatus.FORBIDDEN,
      ),
    );
    return;
  }

  next();
}
