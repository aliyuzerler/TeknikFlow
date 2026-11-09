import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { getEnv } from '../config/env.js';

/**
 * Faz 03 token servisı:
 * - Opak token üretimi (web oturum + davet + refresh) — 32 bayt rastgele,
 *   veritabanında yalnız sha256 özeti saklanır.
 * - Mobil erişim JWT (HS256) — harici bağımlılık yok, node:crypto ile
 *   sabit zamanlı imza doğrulaması; alg/typ başlığı ve exp katı denetlenir.
 */

const OPAQUE_BYTES = 32;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Opak, tek kullanımlık token (ham değer DB'ye asla yazılmaz). */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_BYTES).toString('base64url');
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface AccessTokenClaims {
  sub: string;
  mid: string;
  tid: string;
  role: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtService {
  private readonly secret: string;

  /** Nest DI ile argsız; birim testler farklı anahtarla örneklenebilir. */
  constructor(secretOverride?: string) {
    this.secret = secretOverride ?? getEnv().AUTH_JWT_SECRET;
  }

  signAccessToken(claims: Omit<AccessTokenClaims, 'iat' | 'exp'>, ttlSeconds: number): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: AccessTokenClaims = { ...claims, iat: now, exp: now + ttlSeconds };
    const header = { alg: 'HS256', typ: 'JWT' };
    const segments = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = createHmac('sha256', this.secret).update(segments).digest();
    return `${segments}.${b64url(signature)}`;
  }

  /**
   * İmzayı sabit zamanlı karşılaştırır; başlık alg'ı HS256 dışını, süresi
   * geçmiş/başlamamış payload'ı reddeder. Geçersiz her durum aynı hatayı verir
   * (ayrıntı sızmaz).
   */
  verifyAccessToken(token: string): AccessTokenClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

    let header: { alg?: string; typ?: string };
    let payload: AccessTokenClaims;
    try {
      header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch {
      return null;
    }

    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    if (typeof payload.sub !== 'string' || typeof payload.mid !== 'string') return null;

    const expected = createHmac('sha256', this.secret)
      .update(`${headerPart}.${payloadPart}`)
      .digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(signaturePart, 'base64url');
    } catch {
      return null;
    }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (typeof payload.iat !== 'number' && payload.iat !== undefined) return null;
    return payload;
  }
}
