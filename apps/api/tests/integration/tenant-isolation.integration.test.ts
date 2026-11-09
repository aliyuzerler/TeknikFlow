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
 * TEST-03 §4 — KİRACI İZOLASYONU ve RBAC (gerçek DB/RLS).
 *
 * Kiracı A ve B kurulur; her çapraz erişim denemesi 404 (varlık sızıntısı
 * YOK) ile reddedilmeli. RLS savunma derinliği ham SQL düzeyinde kanıtlanır.
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

async function signup(name: string) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({
      tenantName: `${name} ${RUN}`,
      user: { displayName: `${name} Sahip`, email: email(`owner-${name}`), password: PASSWORD },
    });
  return { response, cookies: extractCookies(response) };
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

interface TenantCtx {
  tenantId: string;
  slug: string;
  ownerEmail: string;
  cookies: { session: string; csrf: string };
}

let tenantA: TenantCtx;
let tenantB: TenantCtx;

/** Davet → yeni kullanıcı kurulumu (web) ile üye ekleme yardımcısı. */
async function addMember(
  tenant: TenantCtx,
  local: string,
  roleKey: string,
): Promise<{ email: string; cookies: { session: string; csrf: string }; membershipId: string }> {
  const inviteeEmail = email(local);
  const invitation = await request(app.getHttpServer())
    .post('/api/v1/tenants/current/invitations')
    .set('Cookie', cookieHeader(tenant.cookies))
    .set('x-csrf-token', tenant.cookies.csrf)
    .send({ email: inviteeEmail, roleKey })
    .expect(201);

  const accept = await request(app.getHttpServer())
    .post(`/api/v1/invitations/${invitation.body.inviteToken}/accept`)
    .send({ password: PASSWORD, displayName: 'Davetli Kullanıcı' })
    .expect(200);

  return {
    email: inviteeEmail,
    cookies: extractCookies(accept),
    membershipId: accept.body.membership.membershipId as string,
  };
}

beforeAll(async () => {
  resetEnvCache();
  getEnv().AUTH_RATE_LIMIT_MAX = 1000;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  prisma = app.get(PrismaService);
  scoped = app.get(TenantScopedPrismaService);
  const redis = app.get<Redis>(REDIS_CLIENT);
  const keys = await redis.keys('rl:*');
  if (keys.length > 0) await redis.del(...keys);

  await seedRbacCatalogue(prisma);
  await seedPlans(prisma);

  const a = await signup('KiraciA');
  const b = await signup('KiraciB');

  // Test gövdesi birçok üye/davet ekler — iki kiracıyı da professional
  // planına yükselt (plan limiti DAVRANIŞI ayrı senaryoda starter ile sınanır).
  await scoped.withPlatformAdmin(async (tx) => {
    const professional = await tx.plan.findUniqueOrThrow({ where: { code: 'professional' } });
    await tx.subscription.updateMany({
      where: {
        tenantId: {
          in: [a.response.body.membership.tenantId, b.response.body.membership.tenantId],
        },
      },
      data: { planId: professional.id },
    });
  });

  tenantA = {
    tenantId: a.response.body.membership.tenantId,
    slug: a.response.body.membership.tenantSlug,
    ownerEmail: a.response.body.user.email,
    cookies: a.cookies,
  };
  tenantB = {
    tenantId: b.response.body.membership.tenantId,
    slug: b.response.body.membership.tenantSlug,
    ownerEmail: b.response.body.user.email,
    cookies: b.cookies,
  };
});

afterAll(async () => {
  await app.close();
});

describe('çapraz-kiracı erişim reddi (IDOR — varlık sızıntısı YOK)', () => {
  it("A yöneticisi B'nin üyesini okuyamaz (404)", async () => {
    const memberB = await addMember(tenantB, 'tech-b', 'technician');
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/tenants/current/members/${memberB.membershipId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ membershipStatus: 'SUSPENDED' });
    // Kiracı A'nın oturumuyla B'nin üyelik kimliği → görünmez (403 değil 404).
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it("A yöneticisi B'nin şubesini güncelleyemez (404)", async () => {
    const branchesB = await scoped.withTenant(tenantB.tenantId, (tx) =>
      tx.branch.findMany({ where: { tenantId: tenantB.tenantId } }),
    );
    const branchB = branchesB[0];
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/tenants/current/branches/${branchB?.id}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ name: 'Sızdırılmış Ad' });
    expect(response.status).toBe(404);
  });

  it("A yöneticisi B'nin davetini iptal edemez (404)", async () => {
    const invitationsB = await request(app.getHttpServer())
      .get('/api/v1/tenants/current/invitations')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .expect(200);
    // B'de henüz açık davet yok → önce bir davet aç.
    const invitation = await request(app.getHttpServer())
      .post('/api/v1/tenants/current/invitations')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .set('x-csrf-token', tenantB.cookies.csrf)
      .send({ email: email('victim-b'), roleKey: 'technician' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .delete(`/api/v1/tenants/current/invitations/${invitation.body.invitationId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf);
    expect(response.status).toBe(404);

    // B kendi davetini görebilir (listede var).
    const listB = await request(app.getHttpServer())
      .get('/api/v1/tenants/current/invitations')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .expect(200);
    expect(listB.body.data.some((i: { email: string }) => i.email === email('victim-b'))).toBe(
      true,
    );
    expect(invitationsB.body.data.length).toBeGreaterThanOrEqual(0);
  });

  it("B'nin üyesi A'nın listesinde ASLA görünmez (kiracı filtresi)", async () => {
    const memberB = await addMember(tenantB, 'hidden-b', 'warehouse');
    const listA = await request(app.getHttpServer())
      .get('/api/v1/tenants/current/members')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    const emailsA = listA.body.data.map((m: { email: string }) => m.email);
    expect(emailsA).not.toContain(memberB.email);
    expect(emailsA.length).toBe(1); // yalnız A'nın sahibi
  });

  it("A'nın audit kayıtları B'ye sızmaz (kiracı kapsamı RLS ile)", async () => {
    // A'da kayıtlı olaylar var (signup, davetler). B sorgular → B'nin KENDİ kayıtları.
    const auditA = await request(app.getHttpServer())
      .get('/api/v1/tenants/current/audit-logs')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    const auditB = await request(app.getHttpServer())
      .get('/api/v1/tenants/current/audit-logs')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .expect(200);
    expect(auditA.body.data.length).toBeGreaterThan(0);
    expect(auditB.body.data.length).toBeGreaterThan(0);
    expect(auditA.body.pageInfo.total).not.toBe(auditB.body.pageInfo.total);

    // Ham doğrulama: B bağlamında okunan HER satır B'nin kiracı kimliğini taşır.
    const rawB = await scoped.withTenant(tenantB.tenantId, (tx) =>
      tx.auditLog.findMany({ where: {}, take: 50 }),
    );
    expect(rawB.length).toBeGreaterThan(0);
    for (const row of rawB) {
      expect(row.tenantId).toBe(tenantB.tenantId);
    }
  });
});

describe('RLS savunma derinliği (ham SQL kanıtı)', () => {
  it('yanlış kiracı bağlamı → 0 satır; doğru bağlam → satır', async () => {
    // A'nın şubesi B bağlamıyla okunamaz.
    const wrongContext = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantB.tenantId}, true)`;
      return tx.branch.findMany({ where: { tenantId: tenantA.tenantId } });
    });
    expect(wrongContext.length).toBe(0);

    // Doğru bağlam → görülür.
    const rightContext = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.branch.findMany({ where: { tenantId: tenantA.tenantId } }),
    );
    expect(rightContext.length).toBe(1);
  });

  it('bağlamsız okuma → 0 satır (FORCE RLS, tablo sahibi olsa bile)', async () => {
    const rows = await prisma.branch.findMany({ where: { tenantId: tenantA.tenantId } });
    expect(rows.length).toBe(0);
    const memberships = await prisma.membership.findMany({ where: { tenantId: tenantA.tenantId } });
    expect(memberships.length).toBe(0);
  });

  it('yanlış kiracı bağlamında YAZMA reddedilir (WITH CHECK)', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantB.tenantId}, true)`;
        return tx.branch.create({
          data: { tenantId: tenantA.tenantId, name: 'Sızan Şube', code: 'SIZ-01' },
        });
      }),
    ).rejects.toThrow();
  });
});

describe('RBAC — sunucu tarafı yetki matrisi', () => {
  it('teknisyen users:manage olmadan üye listesini göremez (403)', async () => {
    const technician = await addMember(tenantA, 'tech-a', 'technician');
    const response = await request(app.getHttpServer())
      .get('/api/v1/tenants/current/members')
      .set('Cookie', cookieHeader(technician.cookies));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('teknisyen şube listeleyebilir (kiracı üyesi) ama şube ekleyemez (403)', async () => {
    const technician = await addMember(tenantA, 'tech2-a', 'technician');
    await request(app.getHttpServer())
      .get('/api/v1/tenants/current/branches')
      .set('Cookie', cookieHeader(technician.cookies))
      .expect(200);

    const response = await request(app.getHttpServer())
      .post('/api/v1/tenants/current/branches')
      .set('Cookie', cookieHeader(technician.cookies))
      .set('x-csrf-token', technician.cookies.csrf)
      .send({ name: 'Yeni Şube', code: 'YENI-01' });
    expect(response.status).toBe(403);
  });

  it('rol değişikliği sonrası izinler yeni istekte geçerli (token yenilenir)', async () => {
    const technician = await addMember(tenantA, 'tech3-a', 'technician');
    // Teknisyen → yönetici.
    await request(app.getHttpServer())
      .patch(`/api/v1/tenants/current/members/${technician.membershipId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ roleKey: 'admin' })
      .expect(200);

    // Yeni oturum açmadan mevcut oturumla da izin taze görünmeli (guard her
    // istekte rolleri DB'den okur).
    const response = await request(app.getHttpServer())
      .get('/api/v1/tenants/current/members')
      .set('Cookie', cookieHeader(technician.cookies));
    expect(response.status).toBe(200);
  });

  it('üyelik askıya alınınca oturum anında etkisiz (403)', async () => {
    const technician = await addMember(tenantA, 'tech4-a', 'technician');
    await request(app.getHttpServer())
      .patch(`/api/v1/tenants/current/members/${technician.membershipId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ membershipStatus: 'SUSPENDED' })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get('/api/v1/tenants/current/branches')
      .set('Cookie', cookieHeader(technician.cookies));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTH_MEMBERSHIP_INACTIVE');
  });

  it('son aktif firma sahibi indirgenemez (hizmet sürekliliği)', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/tenants/current/members')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    const owner = list.body.data.find((m: { roleKey: string }) => m.roleKey === 'owner');
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/tenants/current/members/${owner.membershipId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ roleKey: 'technician' });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('LAST_OWNER_PROTECTED');
  });

  it('özel rol yalnız katalogdan izinlerle kurulabilir', async () => {
    // Geçersiz izin → 400.
    const invalid = await request(app.getHttpServer())
      .post('/api/v1/rbac/roles')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ key: 'on-saha-lider', name: 'Saha Lideri', permissions: ['super:powers'] });
    expect(invalid.status).toBe(400);

    // Sistem rol anahtarı ele geçirilemez → 409.
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/rbac/roles')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ key: 'owner', name: 'Sahte Owner', permissions: ['users:manage'] });
    expect(reserved.status).toBe(409);

    // Geçerli özel rol.
    const valid = await request(app.getHttpServer())
      .post('/api/v1/rbac/roles')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({
        key: 'saha-lider',
        name: 'Saha Lideri',
        permissions: ['work_orders:view_assigned', 'signature:capture'],
      })
      .expect(201);
    expect(valid.body.isSystem).toBe(false);

    // Özel rol davetlerinde kullanılabilir.
    const invitation = await request(app.getHttpServer())
      .post('/api/v1/tenants/current/invitations')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ email: email('lider-a'), roleKey: 'saha-lider' })
      .expect(201);
    expect(invitation.body.inviteToken).toBeTruthy();
  });
});

describe('şube kapsamı (rolden AYRI denetim)', () => {
  it('kapsam dışı şube güncellemesi → 403 BRANCH_SCOPE_DENIED', async () => {
    // İkinci şube (professional planı sınır içinde; starter kiracıda sınır
    // doluysa planı yükselt — kiracı A deneme starter ile kuruldu).
    await scoped.withPlatformAdmin(async (tx) => {
      await tx.subscription.update({
        where: { tenantId: tenantA.tenantId },
        data: { planId: (await tx.plan.findUniqueOrThrow({ where: { code: 'professional' } })).id },
      });
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/tenants/current/branches')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ name: 'İkinci Şube', code: 'IKI-02' })
      .expect(201);

    // Teknisyeni yalnız MERKEZ şubesine kapsamla.
    const list = await request(app.getHttpServer())
      .get('/api/v1/tenants/current/branches')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    const merkez = list.body.data.find((b: { code: string }) => b.code === 'MERKEZ');

    const scopedTech = await addMember(tenantA, 'scoped-tech', 'technician');
    await request(app.getHttpServer())
      .patch(`/api/v1/tenants/current/members/${scopedTech.membershipId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ branchScope: [merkez.branchId] })
      .expect(200);

    // Yönetici olmayan teknisyen zaten 403 alır; kapsam denetimini YÖNETİCİ
    // üzerinden sınayamayız (ALL kapsamlı) — kullanıcı yöneticisini kapsamla.
    const member = await addMember(tenantA, 'scoped-admin', 'admin');
    await request(app.getHttpServer())
      .patch(`/api/v1/tenants/current/members/${member.membershipId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ branchScope: [merkez.branchId] })
      .expect(200);

    // Kapsam DIŞI şubeyi güncelleme → 403 BRANCH_SCOPE_DENIED.
    const denied = await request(app.getHttpServer())
      .patch(`/api/v1/tenants/current/branches/${created.body.branchId}`)
      .set('Cookie', cookieHeader(member.cookies))
      .set('x-csrf-token', member.cookies.csrf)
      .send({ name: 'Kapsam Dışı Güncelleme' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('BRANCH_SCOPE_DENIED');

    // Kapsam İÇİ şube güncellenebilir.
    await request(app.getHttpServer())
      .patch(`/api/v1/tenants/current/branches/${merkez.branchId}`)
      .set('Cookie', cookieHeader(member.cookies))
      .set('x-csrf-token', member.cookies.csrf)
      .send({ name: 'Merkez Güncel' })
      .expect(200);
  });
});

describe('plan limitleri (sunucu tarafı)', () => {
  it('starter kiracıda 2. şube → 403 PLAN_LIMIT_EXCEEDED', async () => {
    const limited = await signup('Starter');
    const cookies = limited.cookies;
    const response = await request(app.getHttpServer())
      .post('/api/v1/tenants/current/branches')
      .set('Cookie', cookieHeader(cookies))
      .set('x-csrf-token', cookies.csrf)
      .send({ name: 'İkinci Şube', code: 'LIM-02' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('max_users dolunca davet → 403 PLAN_LIMIT_EXCEEDED (starter: 5)', async () => {
    const limited = await signup('UserLimit');
    const cookies = limited.cookies;
    // Sahip dahil 5 koltuk: 4 davet eklenir.
    for (let i = 0; i < 4; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/tenants/current/invitations')
        .set('Cookie', cookieHeader(cookies))
        .set('x-csrf-token', cookies.csrf)
        .send({ email: email(`seat-${i}`), roleKey: 'technician' })
        .expect(201);
    }
    // 6. koltuk → limit.
    const response = await request(app.getHttpServer())
      .post('/api/v1/tenants/current/invitations')
      .set('Cookie', cookieHeader(cookies))
      .set('x-csrf-token', cookies.csrf)
      .send({ email: email('seat-5'), roleKey: 'technician' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
});

describe('davet güvenliği', () => {
  it('bilinmeyen token önizlemesi → 404 (üstveri sızmaz)', async () => {
    await request(app.getHttpServer()).get('/api/v1/invitations/unknown-token-value').expect(404);
  });

  it('süresi geçmiş davet kabul edilemez', async () => {
    const invitation = await request(app.getHttpServer())
      .post('/api/v1/tenants/current/invitations')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .set('x-csrf-token', tenantB.cookies.csrf)
      .send({ email: email('expired-b'), roleKey: 'technician' })
      .expect(201);

    // Süreyi geçmiş yap (doğrudan DB).
    const { sha256 } = await import('../../src/auth/token.service.js');
    await prisma.invitation.update({
      where: { tokenHash: sha256(invitation.body.inviteToken as string) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/invitations/${invitation.body.inviteToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${invitation.body.inviteToken}/accept`)
      .send({ password: PASSWORD })
      .expect(404);
  });

  it('davet iptali sonrası kabul edilemez', async () => {
    const invitation = await request(app.getHttpServer())
      .post('/api/v1/tenants/current/invitations')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .set('x-csrf-token', tenantB.cookies.csrf)
      .send({ email: email('revoked-b'), roleKey: 'technician' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/tenants/current/invitations/${invitation.body.invitationId}`)
      .set('Cookie', cookieHeader(tenantB.cookies))
      .set('x-csrf-token', tenantB.cookies.csrf)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${invitation.body.inviteToken}/accept`)
      .send({ password: PASSWORD })
      .expect(404);
  });

  it('mevcut kullanıcının daveti BAŞKA hesaptan kabul edemez (e-posta eşleşmesi)', async () => {
    // B'nin sahibini A'ya davet et.
    const token = await request(app.getHttpServer())
      .post('/api/v1/tenants/current/invitations')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ email: tenantB.ownerEmail, roleKey: 'technician' })
      .expect(201)
      .then((r) => r.body.inviteToken as string);

    // A'nın SAHİBİ (farklı hesap) oturumuyla kabul → e-posta eşleşmez.
    const response = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${token}/accept`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INVITATION_EMAIL_MISMATCH');
  });

  it('aynı e-postaya ikinci açık davet → 409 INVITATION_EXISTS', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/tenants/current/invitations')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .set('x-csrf-token', tenantB.cookies.csrf)
      .send({ email: email('dup-b'), roleKey: 'technician' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/api/v1/tenants/current/invitations')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .set('x-csrf-token', tenantB.cookies.csrf)
      .send({ email: email('dup-b'), roleKey: 'dispatcher' });
    expect(second.status).toBe(409);
  });
});

describe('platform admin ayrımı', () => {
  it('MFA siz platform admin girişi reddedilir (403)', async () => {
    await prisma.user.update({
      where: { emailNormalized: tenantA.ownerEmail },
      data: { platformAdmin: true },
    });
    const login = await loginWeb(tenantA.ownerEmail);
    expect(login.response.status).toBe(403);
    expect(login.response.body.code).toBe('PLATFORM_ADMIN_MFA_REQUIRED');
    await prisma.user.update({
      where: { emailNormalized: tenantA.ownerEmail },
      data: { platformAdmin: false },
    });
  });

  it('normal kiracı kullanıcısı platform uçlarına erişemez (403)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/platform/tenants')
      .set('Cookie', cookieHeader(tenantB.cookies));
    expect(response.status).toBe(403);
  });
});
