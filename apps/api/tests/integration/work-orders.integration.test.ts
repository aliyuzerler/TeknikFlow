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
 * TEST-05 — İŞ EMRİ YAŞAM DÖNGÜSÜ entegrasyon testleri (gerçek DB/RLS).
 *
 * Kabul kriterleri: izinli TÜM geçişler uçtan uca; geçersiz geçişler 409;
 * numara tekilliği (atomik sayaç); atama geçmişi + idempotent yeniden atama;
 * yürütme yetkisi atanmış teknisyene özgü; kapatma yönetici yetkisi;
 * iyimser eşzamanlılık (409); kiracı izolasyonu (404).
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

async function addMember(
  tenant: { cookies: { session: string; csrf: string }; tenantId: string },
  local: string,
  roleKey: string,
): Promise<{ email: string; userId: string; cookies: { session: string; csrf: string } }> {
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
    userId: accept.body.user.userId as string,
    cookies: extractCookies(accept),
  };
}

interface TenantCtx {
  tenantId: string;
  slug: string;
  cookies: { session: string; csrf: string };
  customerId?: string;
}

let tenantA: TenantCtx;
let tenantB: TenantCtx;
let tech1: { userId: string; cookies: { session: string; csrf: string } };
let tech2: { userId: string; cookies: { session: string; csrf: string } };
let dispatcher: { userId: string; cookies: { session: string; csrf: string } };

/** Çerez + CSRF başlıklarıyla hazırlanmış istemci (get/post/patch zincirleri). */
function authed(cookies: { session: string; csrf: string }) {
  const withHeaders = (test: request.Test): request.Test =>
    test.set('Cookie', cookieHeader(cookies)).set('x-csrf-token', cookies.csrf);
  return {
    get: (url: string) => withHeaders(request(app.getHttpServer()).get(url)),
    post: (url: string) => withHeaders(request(app.getHttpServer()).post(url)),
    patch: (url: string) => withHeaders(request(app.getHttpServer()).patch(url)),
  };
}

async function createWorkOrder(
  tenant: TenantCtx,
  overrides: Record<string, unknown> = {},
): Promise<{ workOrderId: string; workOrderNo: string }> {
  const response = await authed(tenant.cookies)
    .post('/api/v1/work-orders')
    .send({
      customerId: tenant.customerId,
      subject: `İE ${RUN}`,
      priority: 'MEDIUM',
      type: 'CORRECTIVE',
      ...overrides,
    })
    .expect(201);
  return { workOrderId: response.body.workOrderId, workOrderNo: response.body.workOrderNo };
}

async function transition(
  cookies: { session: string; csrf: string },
  workOrderId: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return authed(cookies).post(`/api/v1/work-orders/${workOrderId}/transition`).send(body);
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

  const a = await signup('IsEmriA');
  const b = await signup('IsEmriB');
  tenantA = {
    tenantId: a.response.body.membership.tenantId,
    slug: a.response.body.membership.tenantSlug,
    cookies: a.cookies,
  };
  tenantB = {
    tenantId: b.response.body.membership.tenantId,
    slug: b.response.body.membership.tenantSlug,
    cookies: b.cookies,
  };

  for (const tenant of [tenantA, tenantB]) {
    const customer = await authed(tenant.cookies)
      .post('/api/v1/customers')
      .send({ name: `İE Müşteri ${RUN} ${tenant.tenantId.slice(0, 4)}` })
      .expect(201);
    tenant.customerId = customer.body.customerId as string;
  }

  tech1 = await addMember(tenantA, 'tech1', 'technician');
  tech2 = await addMember(tenantA, 'tech2', 'technician');
  dispatcher = await addMember(tenantA, 'dispatcher', 'dispatcher');
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('numara üretimi ve tekillik', () => {
  it('WO-YYYY-NNNN biçiminde ve art arda tektir', async () => {
    const first = await createWorkOrder(tenantA);
    const second = await createWorkOrder(tenantA);
    expect(first.workOrderNo).toMatch(/^WO-\d{4}-\d{4}$/);
    const firstNo = Number(first.workOrderNo.split('-')[2]);
    const secondNo = Number(second.workOrderNo.split('-')[2]);
    expect(secondNo).toBe(firstNo + 1);
  });

  it('eşzamanlı 5 oluşturma → 5 FARKLI numara (atomik sayaç)', async () => {
    const results = await Promise.all([
      createWorkOrder(tenantA),
      createWorkOrder(tenantA),
      createWorkOrder(tenantA),
      createWorkOrder(tenantA),
      createWorkOrder(tenantA),
    ]);
    const numbers = results.map((r) => r.workOrderNo);
    expect(new Set(numbers).size).toBe(5);
  });
});

describe('tam yaşam döngüsü (izinli geçişler uçtan uca)', () => {
  it('DRAFT→PLANNED→ASSIGNED→ACCEPTED→EN_ROUTE→ON_SITE→IN_PROGRESS→COMPLETED→CLOSED', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Yaşam döngüsü ${RUN}` });
    const owner = tenantA.cookies;

    let response = await transition(owner, workOrderId, {
      to: 'PLANNED',
      scheduledStart: '2026-12-02T09:00:00.000Z',
      scheduledEnd: '2026-12-02T13:00:00.000Z',
    });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('PLANNED');
    expect(response.body.scheduledStart).toBe('2026-12-02T09:00:00.000Z');

    response = await transition(owner, workOrderId, {
      to: 'ASSIGNED',
      assigneeUserId: tech1.userId,
    });
    expect(response.status).toBe(201);
    expect(response.body.assignedToName).toBe('Davetli Kullanıcı');

    // Teknisyen KENDİ işini kabul eder (EXECUTION yetkisi atanan bazlı).
    response = await transition(tech1.cookies, workOrderId, { to: 'ACCEPTED' });
    expect(response.status).toBe(201);
    expect(response.body.acceptedAt).toBeTruthy();

    response = await transition(tech1.cookies, workOrderId, { to: 'EN_ROUTE' });
    expect(response.status).toBe(201);
    response = await transition(tech1.cookies, workOrderId, { to: 'ON_SITE' });
    expect(response.status).toBe(201);
    response = await transition(tech1.cookies, workOrderId, { to: 'IN_PROGRESS' });
    expect(response.status).toBe(201);
    expect(response.body.startedAt).toBeTruthy();

    // Not ekleyebilmesi gerekir (atanan görünürlüğü).
    const note = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/notes`)
      .send({ body: 'Keşif tamam; parça gerekli değil.', visibility: 'INTERNAL' })
      .expect(201);
    expect(note.body.authorName).toBe('Davetli Kullanıcı');

    response = await transition(tech1.cookies, workOrderId, { to: 'COMPLETED' });
    expect(response.status).toBe(201);
    expect(response.body.completedAt).toBeTruthy();

    // Teknisyen KAPATAMAZ (yönetici yetkisi) — 403.
    const closeAttempt = await transition(tech1.cookies, workOrderId, { to: 'CLOSED' });
    expect(closeAttempt.status).toBe(403);
    expect(closeAttempt.body.code).toBe('FORBIDDEN');

    // Faz 08 — kanıt kapısı: müşteri imzası olmadan kapatma 409 EVIDENCE_MISSING.
    // (Kanal tümceliği: tamamlandıktan SONRA, kapanmadan ÖNCE imza toplanır.)
    const blockedClose = await transition(owner, workOrderId, { to: 'CLOSED' });
    expect(blockedClose.status).toBe(409);
    expect(blockedClose.body.code).toBe('EVIDENCE_MISSING');

    // Müşteri imzası toplanır (teknisyen signature:capture yetkisiyle).
    await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .send({
        signedBy: 'CUSTOMER',
        signerName: 'İmza Sahibi',
        strokes: [
          [
            { x: 5, y: 12 },
            { x: 55, y: 14 },
            { x: 90, y: 20 },
          ],
        ],
        capturedAt: '2026-11-10T10:00:00.000Z',
      })
      .expect(201);

    response = await transition(owner, workOrderId, { to: 'CLOSED' });
    expect(response.status).toBe(201);
    expect(response.body.closedAt).toBeTruthy();

    // Terminal: kapalıdan hiçbir geçiş yok.
    const reopen = await transition(owner, workOrderId, { to: 'IN_PROGRESS' });
    expect(reopen.status).toBe(409);
    expect(reopen.body.code).toBe('INVALID_TRANSITION');

    // Zaman çizelgesi olayları: created + state_changed zinciri + note + assigned.
    const detail = await authed(owner).get(`/api/v1/work-orders/${workOrderId}`).expect(200);
    const stateChanges = detail.body.events.filter(
      (e: { eventType: string }) => e.eventType === 'work_order.state_changed',
    );
    expect(stateChanges.length).toBe(8);
    expect(
      detail.body.events.some((e: { eventType: string }) => e.eventType === 'work_order.assigned'),
    ).toBe(true);
    expect(
      detail.body.events.some(
        (e: { eventType: string }) => e.eventType === 'work_order.note_added',
      ),
    ).toBe(true);
    expect(detail.body.notes.length).toBe(1);
    expect(detail.body.assignments.length).toBe(1);
    expect(detail.body.assignments[0].status).toBe('ACTIVE');
  });

  it('bekleme döngüsü: IN_PROGRESS→WAITING_PARTS→IN_PROGRESS→WAITING_CUSTOMER→IN_PROGRESS', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Bekleme ${RUN}` });
    const owner = tenantA.cookies;
    await transition(owner, workOrderId, {
      to: 'PLANNED',
      scheduledStart: '2026-12-03T09:00:00.000Z',
      scheduledEnd: '2026-12-03T12:00:00.000Z',
    });
    await transition(owner, workOrderId, { to: 'ASSIGNED', assigneeUserId: tech1.userId });
    await transition(tech1.cookies, workOrderId, { to: 'ACCEPTED' });
    await transition(tech1.cookies, workOrderId, { to: 'EN_ROUTE' });
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE' });
    await transition(tech1.cookies, workOrderId, { to: 'IN_PROGRESS' });

    for (const target of ['WAITING_PARTS', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'IN_PROGRESS']) {
      const response = await transition(tech1.cookies, workOrderId, { to: target });
      expect(response.status, `→ ${target}`).toBe(201);
    }
  });

  it('yeniden açma: COMPLETED→IN_PROGRESS tamamlanma zamanını temizler', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Yeniden açma ${RUN}` });
    const owner = tenantA.cookies;
    await transition(owner, workOrderId, { to: 'PLANNED' });
    await transition(owner, workOrderId, { to: 'ASSIGNED', assigneeUserId: tech1.userId });
    await transition(tech1.cookies, workOrderId, { to: 'ACCEPTED' });
    await transition(tech1.cookies, workOrderId, { to: 'EN_ROUTE' });
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE' });
    await transition(tech1.cookies, workOrderId, { to: 'IN_PROGRESS' });
    await transition(tech1.cookies, workOrderId, { to: 'COMPLETED' });

    const reopened = await transition(tech1.cookies, workOrderId, { to: 'IN_PROGRESS' });
    expect(reopened.status).toBe(201);
    expect(reopened.body.completedAt).toBeNull();
    expect(reopened.body.startedAt).toBeTruthy();
  });

  it('PLANNED→DRAFT geri alma ve ASSIGNED→PLANNED atama kaldırma', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Geri alma ${RUN}` });
    const owner = tenantA.cookies;
    await transition(owner, workOrderId, { to: 'PLANNED' });
    let response = await transition(owner, workOrderId, { to: 'DRAFT' });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('DRAFT');

    await transition(owner, workOrderId, { to: 'PLANNED' });
    await transition(owner, workOrderId, { to: 'ASSIGNED', assigneeUserId: tech1.userId });
    response = await transition(owner, workOrderId, { to: 'PLANNED' });
    expect(response.status).toBe(201);
    expect(response.body.assignedToId).toBeNull();

    // Atama geçmişi REMOVED olarak korunur.
    const detail = await authed(owner).get(`/api/v1/work-orders/${workOrderId}`).expect(200);
    expect(detail.body.assignments.length).toBe(1);
    expect(detail.body.assignments[0].status).toBe('REMOVED');
    expect(detail.body.assignments[0].removedAt).toBeTruthy();
  });
});

describe('geçersiz geçişler reddedilir (409 INVALID_TRANSITION)', () => {
  it('atlama ve geri sarma denemeleri', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Geçersiz ${RUN}` });
    const owner = tenantA.cookies;

    // DRAFT'tan yürütme adımlarına atlanamaz.
    for (const to of ['ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']) {
      const response = await transition(owner, workOrderId, { to });
      expect(response.status, `DRAFT→${to}`).toBe(409);
      expect(response.body.code).toBe('INVALID_TRANSITION');
    }
    // Kendine geçiş.
    const self = await transition(owner, workOrderId, { to: 'DRAFT' });
    expect(self.status).toBe(409);

    // PLANNED iken IN_PROGRESS'a atlanamaz.
    await transition(owner, workOrderId, { to: 'PLANNED' });
    const skip = await transition(owner, workOrderId, { to: 'IN_PROGRESS' });
    expect(skip.status).toBe(409);
  });

  it('şema: ASSIGNED hedefi assigneeUserId olmadan 400; CANCELLED neden kodu olmadan 400', async () => {
    const { workOrderId } = await createWorkOrder(tenantA);
    const missing = await transition(tenantA.cookies, workOrderId, { to: 'ASSIGNED' });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('VALIDATION_ERROR');

    const noReason = await transition(tenantA.cookies, workOrderId, { to: 'CANCELLED' });
    expect(noReason.status).toBe(400);
  });
});

describe('iptal akışı', () => {
  it('her açık durumdan neden koduyla iptal; terminalde 409; planlayıcı da iptal edebilir', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `İptal İE ${RUN}` });
    await transition(tenantA.cookies, workOrderId, { to: 'PLANNED' });

    const cancelled = await transition(dispatcher.cookies, workOrderId, {
      to: 'CANCELLED',
      reasonCode: 'PARTS_UNAVAILABLE',
      note: 'Kritik parça stokta yok',
    });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.cancellationReason).toBe('PARTS_UNAVAILABLE');
    expect(cancelled.body.cancelledAt).toBeTruthy();

    const again = await transition(tenantA.cookies, workOrderId, {
      to: 'CANCELLED',
      reasonCode: 'OTHER',
    });
    expect(again.status).toBe(409);
  });
});

describe('yetki sınırları (yürütme/atanma)', () => {
  it('atanmamış teknisyen iş emrini GÖREMEZ (403, kaynak düzeyi)', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Görünürlük ${RUN}` });
    await transition(tenantA.cookies, workOrderId, { to: 'PLANNED' });
    await transition(tenantA.cookies, workOrderId, {
      to: 'ASSIGNED',
      assigneeUserId: tech1.userId,
    });

    const denied = await request(app.getHttpServer())
      .get(`/api/v1/work-orders/${workOrderId}`)
      .set('Cookie', cookieHeader(tech2.cookies));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');

    // Atanan teknisyen görür.
    const allowed = await request(app.getHttpServer())
      .get(`/api/v1/work-orders/${workOrderId}`)
      .set('Cookie', cookieHeader(tech1.cookies));
    expect(allowed.status).toBe(200);
  });

  it('teknisyen listesi yalnız KENDİ işlerini döndürür; mine=true filtresi', async () => {
    await transition(
      tenantA.cookies,
      (await createWorkOrder(tenantA, { subject: `Benim işim ${RUN}` })).workOrderId,
      { to: 'PLANNED' },
    );
    const mine = await createWorkOrder(tenantA, { subject: `Atanacak ${RUN}` });
    await transition(tenantA.cookies, mine.workOrderId, { to: 'PLANNED' });
    await transition(tenantA.cookies, mine.workOrderId, {
      to: 'ASSIGNED',
      assigneeUserId: tech2.userId,
    });

    const list = await request(app.getHttpServer())
      .get('/api/v1/work-orders?pageSize=100')
      .set('Cookie', cookieHeader(tech2.cookies))
      .expect(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    for (const row of list.body.data) {
      expect(row.assignedToId).toBe(tech2.userId);
    }
  });

  it('planlayıcı (dispatcher) yürütme adımı atamaz — complete izni yok', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Planlayıcı ${RUN}` });
    await transition(tenantA.cookies, workOrderId, { to: 'PLANNED' });
    await transition(tenantA.cookies, workOrderId, {
      to: 'ASSIGNED',
      assigneeUserId: tech1.userId,
    });
    const attempt = await transition(dispatcher.cookies, workOrderId, { to: 'ACCEPTED' });
    expect(attempt.status).toBe(403);
  });

  it('atanmayan kullanıcıya atama reddedilir ve atanabilir-olmayan rol reddedilir', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Atama ${RUN}` });
    await transition(tenantA.cookies, workOrderId, { to: 'PLANNED' });

    // Kiracı dışı kullanıcı kimliği → 404 (üye değil).
    const notMember = await transition(tenantA.cookies, workOrderId, {
      to: 'ASSIGNED',
      assigneeUserId: '00000000-0000-4000-8000-000000000001',
    });
    expect(notMember.status).toBe(404);
    expect(notMember.body.code).toBe('ASSIGNEE_NOT_MEMBER');

    // Finans rolündeki üye atanabilir değil — dispatcher ekleyelim.
    const finance = await addMember(tenantA, 'finans', 'finance');
    const notAssignable = await transition(tenantA.cookies, workOrderId, {
      to: 'ASSIGNED',
      assigneeUserId: finance.userId,
    });
    expect(notAssignable.status).toBe(400);
    expect(notAssignable.body.code).toBe('ASSIGNEE_NOT_ASSIGNABLE');
  });

  it('aynı teknisyene çift atama idempotent: ikinci istem yeni kayıt üretmez', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Çift atama ${RUN}` });
    await transition(tenantA.cookies, workOrderId, { to: 'PLANNED' });
    const first = await transition(tenantA.cookies, workOrderId, {
      to: 'ASSIGNED',
      assigneeUserId: tech1.userId,
    });
    expect(first.status).toBe(201);
    const second = await transition(tenantA.cookies, workOrderId, {
      to: 'ASSIGNED',
      assigneeUserId: tech1.userId,
    });
    expect(second.status).toBe(201);

    const detail = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders/${workOrderId}`)
      .expect(200);
    expect(detail.body.assignments.length).toBe(1);
  });

  it('atanabilir kullanıcılar listesi teknisyenleri döndürür (dispatch yetkisi)', async () => {
    const list = await authed(dispatcher.cookies)
      .get('/api/v1/work-orders/assignable-users')
      .expect(200);
    const ids = list.body.data.map((u: { userId: string }) => u.userId);
    expect(ids).toContain(tech1.userId);
    expect(ids).toContain(tech2.userId);
    // Teknisyen kendisi bu ucu çağıramaz.
    const denied = await request(app.getHttpServer())
      .get('/api/v1/work-orders/assignable-users')
      .set('Cookie', cookieHeader(tech1.cookies));
    expect(denied.status).toBe(403);
  });
});

describe('iyimser eşzamanlılık', () => {
  it('eski sürümle PATCH → 409 VERSION_CONFLICT', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Sürüm ${RUN}` });
    const first = await authed(tenantA.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .send({ subject: 'Güncel konu', expectedVersion: 0 })
      .expect(200);
    expect(first.body.version).toBe(1);
    const stale = await authed(tenantA.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .send({ subject: 'Bayat güncelleme', expectedVersion: 0 })
      .expect(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('geçişte eski expectedVersion → 409', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Sürüm geçiş ${RUN}` });
    await authed(tenantA.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .send({ subject: 'Konu değişti', expectedVersion: 0 })
      .expect(200); // version 1
    const stale = await transition(tenantA.cookies, workOrderId, {
      to: 'PLANNED',
      expectedVersion: 0,
    });
    expect(stale.status).toBe(409);
    // Doğru sürümle geçiş çalışır.
    const ok = await transition(tenantA.cookies, workOrderId, {
      to: 'PLANNED',
      expectedVersion: 1,
    });
    expect(ok.status).toBe(201);
  });
});

describe('kiracı izolasyonu (TEST-05 §4)', () => {
  it('çapraz-kiracı okuma/liste/transition/not → 404/boş', async () => {
    const { workOrderId, workOrderNo } = await createWorkOrder(tenantA, {
      subject: `İzole İE ${RUN}`,
    });

    await request(app.getHttpServer())
      .get(`/api/v1/work-orders/${workOrderId}`)
      .set('Cookie', cookieHeader(tenantB.cookies))
      .expect(404);

    const listB = await request(app.getHttpServer())
      .get('/api/v1/work-orders?pageSize=100')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .expect(200);
    expect(
      listB.body.data.some((w: { workOrderNo: string }) => w.workOrderNo === workOrderNo),
    ).toBe(false);

    const cross = await transition(tenantB.cookies, workOrderId, {
      to: 'CANCELLED',
      reasonCode: 'OTHER',
    });
    expect(cross.status).toBe(404);

    await authed(tenantB.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/notes`)
      .send({ body: 'çapraz not' })
      .expect(404);

    await authed(tenantB.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .send({ subject: 'çapraz düzenleme', expectedVersion: 0 })
      .expect(404);
  });

  it('RLS ham kanıt: B bağlamında A’nın iş emri satırı görünmez', async () => {
    const count = await scoped.withTenant(tenantB.tenantId, (tx) =>
      tx.workOrder.count({ where: { tenantId: tenantA.tenantId } }),
    );
    expect(count).toBe(0);
  });

  it('çapraz-kiracı müşteri kimliğiyle iş emri oluşturma → 404', async () => {
    await authed(tenantA.cookies)
      .post('/api/v1/work-orders')
      .send({ customerId: tenantB.customerId, subject: 'Çapraz müşteri İE' })
      .expect(404);
  });
});

describe('not görünürlüğü', () => {
  it('dahili ve müşteri görünür notlar ayrı etiketle listelenir', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Notlar ${RUN}` });
    await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/notes`)
      .send({ body: 'Dahili not: maliyet göz önünde', visibility: 'INTERNAL' })
      .expect(201);
    await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/notes`)
      .send({ body: 'Müşteriye görünür: iş tamam planlı', visibility: 'CUSTOMER' })
      .expect(201);

    const detail = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders/${workOrderId}`)
      .expect(200);
    const visibilities = detail.body.notes.map((n: { visibility: string }) => n.visibility).sort();
    expect(visibilities).toEqual(['CUSTOMER', 'INTERNAL']);
    // Olay meta verisi gövde taşımaz (yalnız kimlik + görünürlük).
    const noteEvent = detail.body.events.find(
      (e: { eventType: string }) => e.eventType === 'work_order.note_added',
    );
    expect(noteEvent.metadata.noteId).toBeTruthy();
    expect(noteEvent.metadata.body).toBeUndefined();
  });
});

describe('liste filtreleri ve sayfalama', () => {
  it('durum/öncelik filtresi + sayfalama meta verisi', async () => {
    const list = await authed(tenantA.cookies)
      .get('/api/v1/work-orders?status=DRAFT&priority=MEDIUM&pageSize=5&page=1')
      .expect(200);
    expect(list.body.pageInfo.pageSize).toBe(5);
    for (const row of list.body.data) {
      expect(row.status).toBe('DRAFT');
      expect(row.priority).toBe('MEDIUM');
    }
    // Arama: numara ile bulma.
    const probe = await createWorkOrder(tenantA);
    const search = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders?q=${probe.workOrderNo}`)
      .expect(200);
    expect(
      search.body.data.some((w: { workOrderNo: string }) => w.workOrderNo === probe.workOrderNo),
    ).toBe(true);
  });
});
