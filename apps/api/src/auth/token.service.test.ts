import { beforeAll, describe, expect, it } from 'vitest';
import { JwtService } from './token.service.js';
import { resetEnvCache } from '../config/env.js';

/**
 * JWT servis — imza, tinker direnci, exp.
 * Test için belirli bir anahtarla ortam hazırlanır (memoizasyon sıfırlanır).
 */
const TEST_SECRET = 'x'.repeat(48);

beforeAll(() => {
  process.env.AUTH_JWT_SECRET = TEST_SECRET;
  resetEnvCache();
});

describe('JwtService', () => {
  const service = new JwtService();

  const claims = { sub: 'user-1', mid: 'member-1', tid: 'tenant-1', role: 'owner' };

  it('imzalı token doğrulanır ve iddialar geri okunur', () => {
    const token = service.signAccessToken(claims, 60);
    const parsed = service.verifyAccessToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed?.sub).toBe('user-1');
    expect(parsed?.mid).toBe('member-1');
    expect(parsed?.tid).toBe('tenant-1');
    expect(parsed?.role).toBe('owner');
    expect(parsed?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('imza değiştirilmiş payload reddedilir', () => {
    const token = service.signAccessToken(claims, 60);
    const [header, , signature] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ ...claims, sub: 'admin-999' })).toString(
      'base64url',
    );
    expect(service.verifyAccessToken(`${header}.${tamperedPayload}.${signature}`)).toBeNull();
  });

  it('başka anahtarla imzalanmış token reddedilir', () => {
    const token = service.signAccessToken(claims, 60);
    const other = new JwtService('y'.repeat(48));
    const otherToken = other.signAccessToken(claims, 60);
    expect(service.verifyAccessToken(otherToken)).toBeNull();
    expect(other.verifyAccessToken(token)).toBeNull();
  });

  it('süresi geçmiş token reddedilir', () => {
    const token = service.signAccessToken(claims, -10);
    expect(service.verifyAccessToken(token)).toBeNull();
  });

  it('bozuk biçim ve "none" algoritma reddedilir', () => {
    expect(service.verifyAccessToken('not-a-jwt')).toBeNull();
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    const payload = Buffer.from(JSON.stringify({ ...claims, exp: 9999999999 })).toString(
      'base64url',
    );
    expect(service.verifyAccessToken(`${noneHeader}.${payload}.x`)).toBeNull();
  });

  it('kesilmiş/kısaltılmış imza reddedilir', () => {
    const token = service.signAccessToken(claims, 60);
    const parts = token.split('.');
    const truncated = `${parts[0]}.${parts[1]}.${(parts[2] ?? '').slice(0, 10)}`;
    expect(service.verifyAccessToken(truncated)).toBeNull();
    expect(service.verifyAccessToken(`${parts[0]}.${parts[1]}`)).toBeNull();
  });
});
