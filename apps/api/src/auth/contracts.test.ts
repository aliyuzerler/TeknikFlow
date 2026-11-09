import { describe, expect, it } from 'vitest';
import {
  AcceptInvitationRequestSchema,
  branchScopeSchema,
  emailSchema,
  LoginRequestSchema,
  passwordSchema,
  SignupRequestSchema,
} from '@teknikflow/contracts';

/**
 * Faz 03 sözleşme doğrulamaları — API sınırındaki ilk savunma.
 */
describe('e-posta şeması', () => {
  it('normalizasyon: trim + küçük harf', () => {
    expect(emailSchema.parse('  Ali@Firma.COM ')).toBe('ali@firma.com');
  });
  it('geçersiz biçim reddedilir', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('a@b').success).toBe(false);
    expect(emailSchema.safeParse('a b@c.com').success).toBe(false);
  });
});

describe('parola politikası', () => {
  it('10+ karakter, harf+rakam kabul', () => {
    expect(passwordSchema.safeParse('Saha2026x').success).toBe(false); // 9 karakter
    expect(passwordSchema.safeParse('SahaServis2026').success).toBe(true);
  });
  it('yalnız harf veya yalnız rakam reddedilir', () => {
    expect(passwordSchema.safeParse('sadeceharfler').success).toBe(false);
    expect(passwordSchema.safeParse('1234567890').success).toBe(false);
  });
});

describe('şube kapsamı', () => {
  it('ALL ya da uuid listesi', () => {
    expect(branchScopeSchema.safeParse('ALL').success).toBe(true);
    expect(branchScopeSchema.safeParse(['a41dffca-ec44-4da4-a56f-5b585018c071']).success).toBe(
      true,
    );
  });
  it('boş liste ve karışık tür reddedilir', () => {
    expect(branchScopeSchema.safeParse([]).success).toBe(false);
    expect(branchScopeSchema.safeParse(['not-uuid']).success).toBe(false);
    expect(branchScopeSchema.safeParse('SOME').success).toBe(false);
  });
});

describe('login isteği', () => {
  it('istemci türü varsayılan web, mobil kabul', () => {
    const parsed = LoginRequestSchema.parse({ email: 'a@b.com', password: 'x'.repeat(10) });
    expect(parsed.client).toBe('web');
    const mobile = LoginRequestSchema.parse({
      email: 'a@b.com',
      password: 'x'.repeat(10),
      client: 'mobile',
    });
    expect(mobile.client).toBe('mobile');
  });
  it('geçersiz istemci reddedilir', () => {
    expect(
      LoginRequestSchema.safeParse({
        email: 'a@b.com',
        password: 'x'.repeat(10),
        client: 'desktop',
      }).success,
    ).toBe(false);
  });
});

describe('signup isteği', () => {
  const valid = {
    tenantName: 'Atlas Teknik',
    user: { displayName: 'Ali Yılmaz', email: 'ali@atlas.test', password: 'SahaServis2026' },
  };
  it('geçerli kayıt kabul edilir ve saat dilimi varsayılan alır', () => {
    const parsed = SignupRequestSchema.parse(valid);
    expect(parsed.timezone).toBe('Europe/Istanbul');
  });
  it('slug biçimi denetlenir', () => {
    expect(SignupRequestSchema.safeParse({ ...valid, slug: 'Atlas Teknik' }).success).toBe(false);
    expect(SignupRequestSchema.safeParse({ ...valid, slug: 'atlas-teknik' }).success).toBe(true);
  });
});

describe('davet kabulü', () => {
  it('şema parolayı opsiyonel tutar (mevcut kullanıcı akışı); yeni kullanıcıda servis zorunlu kılar', () => {
    // İki akış: mevcut kullanıcı parolasız, yeni kullanıcı parolalı.
    // Yeni kullanıcıda parolasız istek servis katmanında PASSWORD_REQUIRED
    // ile reddedilir (bkz. tenants.service) — şema iki biçimi de kabul eder.
    expect(AcceptInvitationRequestSchema.safeParse({ displayName: 'Yeni Kullanıcı' }).success).toBe(
      true,
    );
    expect(AcceptInvitationRequestSchema.safeParse({ password: 'SahaServis2026' }).success).toBe(
      true,
    );
    // Verilirse parola politikası denetlenir:
    expect(AcceptInvitationRequestSchema.safeParse({ password: 'kisa1234' }).success).toBe(false);
  });
});
