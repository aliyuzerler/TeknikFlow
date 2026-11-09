import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/common/configure-app.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TenantScopedPrismaService } from '../../src/common/tenant-scoped-prisma.js';
import { seedPlans, seedRbacCatalogue } from '../../src/rbac/rbac-catalogue.seed.js';
import { resetEnvCache, getEnv } from '../../src/config/env.js';
import { REDIS_CLIENT } from '../../src/redis/redis.module.js';
import type { Redis } from 'ioredis';

/**
 * TEST-03 §3-§4 — kimlik akışları, RBAC, CSRF, oturum iptali (gerçek DB/Redis).
 *
 * Test verisi ÇALIŞMA ANINDA üretilir (rastgele e-postalar) — sabit kimlik yok,
 * koşumlar arasında sızıntı yok. Genel hata mesajı (sayım azaltma) doğrulanır.
 */

const RUN = Date.now().toString(36);
const email = (local: string) => `${local}.${RUN}@test.example`;
const PASSWORD = 'SahaServis2026';

let app: INestApplication;
let prisma: PrismaService;
let scoped: TenantScopedPrismaService;

function extractCookies(response: request.Response): { session: string; csrf: string } {
  const setCookies = response.headers['set-cookie'] ?? [];
  let session = '';
  let csrf = '';
  for (const raw of setCookies) {
    if (raw.startsWith('tf_session=')) session = raw.split(';')[0]?.split('=')[1] ?? '';
    if (raw.startsWith('tf_csrf=')) csrf = raw.split(';')[0]?.split('=')[1] ?? '';
  }
  return { session, csrf };
}

function cookieHeader(cookies: { session: string; csrf?: string }): string {
  const parts = [`tf_session=${cookies.session}`];
  if (cookies.csrf) parts.push(`tf_csrf=${cookies.csrf}`);
  return parts.join('; ');
}

/** Yeni kiracı + owner oturumu kurar; test gövdesinde kiracı A/B olarak kullanılır. */
async function createTenant(name: string) {
  const ownerEmail = email(`owner-${name.toLowerCase()}`);
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({
      tenantName: `${name} Test ${RUN}`,
      user: { displayName: `${name} Sahip`, email: ownerEmail, password: PASSWORD },
    })
    .expect(201);
  const cookies = extractCookies(response);
  return {
    tenantId: response.body.membership.tenantId as string,
    slug: response.body.membership.tenantSlug as string,
    ownerEmail,
    cookies,
    body: response.body as {
      membership: { tenantId: string; tenantSlug: string; roleKey: string; branchScope: string };
      user: { email: string };
    },
  };
}

/** Yardımcı: davet oluştur (owner oturumuyla) → token döner. */
async function invite(
  cookies: { session: string; csrf: string },
  inviteeEmail: string,
  roleKey = 'technician',
) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/tenants/current/invitations')
    .set('Cookie', cookieHeader(cookies))
    .set('x-csrf-token', cookies.csrf)
    .send({ email: inviteeEmail, roleKey })
    .expect(201);
  return response.body.inviteToken as string;
}

async function loginWeb(userEmail: string, slug?: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({
      email: userEmail,
      password: PASSWORD,
      client: 'web',
      ...(slug ? { tenantSlug: slug } : {}),
    });
  return { response, cookies: extractCookies(response) };
}

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
  resetEnvCache();
  // Tüm testler tek IP'den (127.0.0.1) koşar — rate limit kasıtlı olarak
  // gevşetilir; 429 DAVRANIŞI ayrı dosyada düşük limitli örnekle sınanır.
  getEnv().AUTH_RATE_LIMIT_MAX = 1000;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  // configureApp main.ts ile birebir (CSRF, önek, hata zarfı dahil).
  configureApp(app);
  await app.init();

  prisma = app.get(PrismaService);
  scoped = app.get(TenantScopedPrismaService);

  // Kalıntı rate-limit kovalarını temizle (önceki koşum/el denemeleri).
  const redis = app.get<Redis>(REDIS_CLIENT);
  const keys = await redis.keys('rl:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  // Katalog + planlar (idempotent) — testler katalogdan bağımsız KOŞMAZ.
  await seedRbacCatalogue(prisma);
  await seedPlans(prisma);
});

afterAll(async () => {
  await app.close();
});

describe('POST /auth/signup — kiracı kaydı (onboarding)', () => {
  it('kiracı + varsayılan şube + owner üyeliği + deneme aboneliği kurar ve oturum açar', async () => {
    const tenant = await createTenant('Signup');

    expect(tenant.body.membership.roleKey).toBe('owner');
    expect(tenant.cookies.session.length).toBeGreaterThan(20);

    // Varsayılan şube MERKEZ koduyla var.
    const branches = await scoped.withTenant(tenant.tenantId, (tx) =>
      tx.branch.findMany({ where: { tenantId: tenant.tenantId } }),
    );
    expect(branches.map((b) => b.code)).toEqual(['MERKEZ']);

    // Deneme aboneliği starter planıyla.
    const subscription = await scoped.withTenant(tenant.tenantId, (tx) =>
      tx.subscription.findUnique({ where: { tenantId: tenant.tenantId }, include: { plan: true } }),
    );
    expect(subscription?.plan.code).toBe('starter');
    expect(subscription?.status).toBe('TRIALING');

    // Audit: tenant.signup kaydı kiracı kapsamında yazılmış.
    const audits = await scoped.withTenant(tenant.tenantId, (tx) =>
      tx.auditLog.findMany({ where: { tenantId: tenant.tenantId, action: 'tenant.signup' } }),
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('aynı e-posta ile ikinci kayıt → 409 EMAIL_TAKEN', async () => {
    const tenant = await createTenant('Dup');
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'Başka Firma',
        user: { displayName: 'Başka Sahip', email: tenant.ownerEmail, password: PASSWORD },
      })
      .expect(409);
  });

  it('zayıf parola şema düzeyinde reddedilir (VALIDATION_ERROR)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'Zayıf Parola',
        user: { displayName: 'Test Sahip', email: email('weak'), password: 'short1' },
      })
      .expect(400);
  });
});

describe('POST /auth/login — parola akışı', () => {
  it('yanlış parola ve bilinmeyen e-posta AYNI genel mesajı alır (sayım azaltma)', async () => {
    const tenant = await createTenant('Login');
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: tenant.ownerEmail, password: 'WrongPassword9' });
    const unknownEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: email('nobody'), password: 'WrongPassword9' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('doğru girişte oturum çerezleri + tam bağlam döner', async () => {
    const tenant = await createTenant('LoginOk');
    const { response } = await loginWeb(tenant.ownerEmail);
    expect(response.status).toBe(200);
    expect(response.body.membership.tenantSlug).toBe(response.body.membership.tenantSlug);
    expect(response.body.permissions).toContain('users:manage');
    expect(response.body.permissions).toContain('tenant:manage');
  });

  it('askıya alınan hesap girişi genel hata ile reddedilir', async () => {
    const tenant = await createTenant('Susp');
    await prisma.user.update({
      where: { emailNormalized: tenant.ownerEmail },
      data: { status: 'SUSPENDED' },
    });
    const { response } = await loginWeb(tenant.ownerEmail);
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('E-posta veya parola hatalı');
  });
});

describe('GET /auth/me + oturum ömrü', () => {
  it('oturumla tam bağlam döner; oturumsuz → 401', async () => {
    const tenant = await createTenant('Me');
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', `tf_session=${tenant.cookies.session}`)
      .expect(200);
    expect(me.body.membership.tenantId).toBe(tenant.tenantId);
    expect(me.body.user.email).toBe(tenant.ownerEmail);

    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('logout sonrası oturum geçersiz (veritabanı iptali)', async () => {
    const tenant = await createTenant('Logout');
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(tenant.cookies))
      .set('x-csrf-token', tenant.cookies.csrf)
      .expect(204);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', `tf_session=${tenant.cookies.session}`)
      .expect(401);
  });

  it('oturum listesi + tekil iptal + revoke-all', async () => {
    const tenant = await createTenant('Sessions');
    // İkinci oturum.
    const second = await loginWeb(tenant.ownerEmail);
    expect(second.cookies.session).not.toBe(tenant.cookies.session);

    const list = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Cookie', `tf_session=${tenant.cookies.session}`)
      .expect(200);
    expect(list.body.data.length).toBe(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current).length).toBe(1);

    // Tekil iptal (kendi oturumu).
    const otherSession = list.body.data.find((s: { current: boolean }) => !s.current);
    await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${otherSession.sessionId}`)
      .set('Cookie', cookieHeader(tenant.cookies))
      .set('x-csrf-token', tenant.cookies.csrf)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', `tf_session=${second.cookies.session}`)
      .expect(401);

    // Revoke-all: kalan oturum da ölür.
    await request(app.getHttpServer())
      .post('/api/v1/auth/sessions/revoke-all')
      .set('Cookie', cookieHeader(tenant.cookies))
      .set('x-csrf-token', tenant.cookies.csrf)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', `tf_session=${tenant.cookies.session}`)
      .expect(401);
  });
});

describe('CSRF (çerezli oturum, güvensiz fiil)', () => {
  it('başlıksız POST → 403 CSRF_INVALID', async () => {
    const tenant = await createTenant('Csrf');
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', `tf_session=${tenant.cookies.session}`)
      .send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CSRF_INVALID');
  });

  it('başlık + çerez eşleşince geçer', async () => {
    const tenant = await createTenant('CsrfOk');
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(tenant.cookies))
      .set('x-csrf-token', tenant.cookies.csrf)
      .expect(204);
  });
});

describe('mobil token akışı (JWT + dönen refresh)', () => {
  it('login → access + refresh; Bearer /auth/me çalışır; rotasyon yeni çift verir', async () => {
    const tenant = await createTenant('Mobile');
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: tenant.ownerEmail, password: PASSWORD, client: 'mobile' })
      .expect(200);
    const { accessToken, refreshToken } = login.body;

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(refreshToken);
    expect(rotated.body.accessToken).toBeTruthy();

    // Yeni access token da geçerli.
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotated.body.accessToken}`)
      .expect(200);
  });

  it('refresh yeniden kullanım tespiti → 401 ve türetilen token da ölür', async () => {
    const tenant = await createTenant('Reuse');
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: tenant.ownerEmail, password: PASSWORD, client: 'mobile' })
      .expect(200);

    // İlk rotasyon.
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    // ESKİ token yeniden sunulur (hırsızlık senaryosu) → aile iptali.
    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expect(reuse.status).toBe(401);

    // Aile iptali: rotasyonla üretilen YENİ token da artık geçersiz.
    const afterReuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken });
    expect(afterReuse.status).toBe(401);
  });

  it('logout refresh token iptal eder', async () => {
    const tenant = await createTenant('MobileLogout');
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: tenant.ownerEmail, password: PASSWORD, client: 'mobile' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ refreshToken: login.body.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });
});

describe('çoklu kiracı üyeliği', () => {
  it('iki kiracıda üye → seçim listesi; slug ile oturum kurulur', async () => {
    const tenantA = await createTenant('MultiA');
    const tenantB = await createTenant('MultiB');

    // B'nin sahibini A'ya davet et ve kabul ettir.
    const token = await invite(tenantA.cookies, tenantB.ownerEmail, 'dispatcher');
    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${token}/accept`)
      .set('Cookie', cookieHeader(tenantB.cookies))
      .set('x-csrf-token', tenantB.cookies.csrf)
      .send({})
      .expect(200);

    // Çoklu üyelik: seçim gerekli.
    const { response } = await loginWeb(tenantB.ownerEmail);
    expect(response.status).toBe(200);
    expect(response.body.selectionRequired).toBe(true);
    expect(response.body.workspaces.length).toBe(2);

    // Slug ile seçim → oturum A bağlamıyla kurulur.
    const chosen = await loginWeb(tenantB.ownerEmail, tenantA.slug);
    expect(chosen.response.status).toBe(200);
    expect(chosen.response.body.membership.tenantId).toBe(tenantA.tenantId);
    expect(chosen.response.body.membership.roleKey).toBe('dispatcher');

    // Geçersiz slug genel hata (varlık sızıntısı yok).
    const invalid = await loginWeb(tenantB.ownerEmail, 'olmayan-kiraci');
    expect(invalid.response.status).toBe(401);
    expect(invalid.response.body.message).toBe('E-posta veya parola hatalı');
  });
});
