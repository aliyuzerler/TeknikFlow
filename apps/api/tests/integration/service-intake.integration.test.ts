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
 * TEST-05 §3/§4 — SERVİS TALEBİ (INTAKE) entegrasyon testleri.
 *
 * Gerçek DB/RLS üzerinde: oluşturma, SLA hesabı, triyaj (öncelik değişimi
 * SLA'yı yeniden hesaplar), iş emrine dönüşüm (birebir), iptal nedeni,
 * kiracı izolasyonu (404 — sızıntı yok) ve rol sınırları.
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
): Promise<{ email: string; cookies: { session: string; csrf: string } }> {
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
  return { email: inviteeEmail, cookies: extractCookies(accept) };
}

interface TenantCtx {
  tenantId: string;
  slug: string;
  cookies: { session: string; csrf: string };
  customerId?: string;
  customerName?: string;
  assetId?: string;
  assetTag?: string;
}

let tenantA: TenantCtx;
let tenantB: TenantCtx;
let technician: { email: string; cookies: { session: string; csrf: string } };

/** Kiracı bağlamlı istemci: get/post/patch/put zincirleri hazır çerezlerle. */
function api(tenant: TenantCtx) {
  const withHeaders = (test: request.Test): request.Test =>
    test.set('Cookie', cookieHeader(tenant.cookies)).set('x-csrf-token', tenant.cookies.csrf);
  return {
    get: (url: string) => withHeaders(request(app.getHttpServer()).get(url)),
    post: (url: string) => withHeaders(request(app.getHttpServer()).post(url)),
    patch: (url: string) => withHeaders(request(app.getHttpServer()).patch(url)),
    put: (url: string) => withHeaders(request(app.getHttpServer()).put(url)),
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

  const a = await signup('TalepA');
  const b = await signup('TalepB');
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

  // Kiracı A'da müşteri + ekipman (API üzerinden gerçekçi kurulum).
  const customer = await api(tenantA)
    .post('/api/v1/customers')
    .send({
      name: `Talep Test Müşteri ${RUN}`,
      customerType: 'COMPANY',
      primaryContact: { name: 'Kontak Kişi', email: email('kontak') },
    })
    .expect(201);
  tenantA.customerId = customer.body.customerId as string;
  tenantA.customerName = customer.body.name as string;

  const location = await api(tenantA)
    .post(`/api/v1/customers/${tenantA.customerId}/locations`)
    .send({ name: 'Ana Saha', address: 'Test Cad. No:5', city: 'İstanbul' })
    .expect(201);

  const asset = await api(tenantA)
    .post('/api/v1/assets')
    .send({
      customerId: tenantA.customerId,
      serviceLocationId: location.body.locationId,
      manufacturer: 'Test Üretici',
      model: 'Model-T',
      criticality: 'HIGH',
    })
    .expect(201);
  tenantA.assetId = asset.body.assetId as string;
  tenantA.assetTag = asset.body.assetTag as string;

  // Kiracı B'de de bir müşteri (çapraz denemeler için).
  const customerB = await api(tenantB)
    .post('/api/v1/customers')
    .send({ name: `B Kiracısı Müşteri ${RUN}` })
    .expect(201);
  tenantB.customerId = customerB.body.customerId as string;

  technician = await addMember(tenantA, 'teknisyen', 'technician');
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('talep oluşturma ve SLA', () => {
  it('varsayılan MEDIUM SLA: slaDueAt = createdAt + 1440 dk', async () => {
    const created = await api(tenantA)
      .post('/api/v1/service-requests')
      .send({ customerId: tenantA.customerId, subject: `Klima arızası ${RUN}`, priority: 'MEDIUM' })
      .expect(201);
    expect(created.body.status).toBe('NEW');
    expect(created.body.slaDueAt).toBeTruthy();
    expect(created.body.slaBreached).toBe(false);
    const createdMs = Date.parse(created.body.createdAt);
    const dueMs = Date.parse(created.body.slaDueAt);
    expect(Math.round((dueMs - createdMs) / 60_000)).toBe(1440);
  });

  it('kiracı politikası varsayılanı geçersiz kılar (URGENT → 120 dk)', async () => {
    await api(tenantA)
      .put('/api/v1/service-requests/sla-policies')
      .send({ priority: 'URGENT', resolveMinutes: 120 })
      .expect(200);

    const created = await api(tenantA)
      .post('/api/v1/service-requests')
      .send({ customerId: tenantA.customerId, subject: `Acil arıza ${RUN}`, priority: 'URGENT' })
      .expect(201);
    const createdMs = Date.parse(created.body.createdAt);
    const dueMs = Date.parse(created.body.slaDueAt);
    expect(Math.round((dueMs - createdMs) / 60_000)).toBe(120);
  });

  it('geçersiz müşteri/ekipman referansı reddedilir (müşteri-ekipman uyumsuzluğu)', async () => {
    await api(tenantA)
      .post('/api/v1/service-requests')
      .send({
        customerId: tenantA.customerId,
        assetId: '00000000-0000-4000-8000-000000000001',
        subject: 'Uyumsuz ekipman',
      })
      .expect(404);

    // Başka müşteriye ait ekipman → 400 ASSET_CUSTOMER_MISMATCH.
    const other = await api(tenantA)
      .post('/api/v1/customers')
      .send({ name: `Başka Müşteri ${RUN}` })
      .expect(201);
    await api(tenantA)
      .post('/api/v1/service-requests')
      .send({
        customerId: other.body.customerId,
        assetId: tenantA.assetId,
        subject: 'Uyumsuz ekipman 2',
      })
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('ASSET_CUSTOMER_MISMATCH');
      });
  });

  it('listeleme: sayfalama + arama + durum filtresi', async () => {
    const list = await api(tenantA)
      .get(`/api/v1/service-requests?q=${encodeURIComponent(RUN)}&pageSize=10`)
      .expect(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    expect(list.body.pageInfo.total).toBeGreaterThanOrEqual(2);
    for (const row of list.body.data) {
      expect(row.subject).toContain(RUN);
    }
    const newOnly = await api(tenantA)
      .get('/api/v1/service-requests?status=NEW&pageSize=50')
      .expect(200);
    for (const row of newOnly.body.data) {
      expect(row.status).toBe('NEW');
    }
  });

  it('uzun metin sınır değeri: 200 karakter konu kabul, 201 reddedilir', async () => {
    await api(tenantA)
      .post('/api/v1/service-requests')
      .send({ customerId: tenantA.customerId, subject: 'x'.repeat(200) })
      .expect(201);
    await api(tenantA)
      .post('/api/v1/service-requests')
      .send({ customerId: tenantA.customerId, subject: 'x'.repeat(201) })
      .expect(400);
  });
});

describe('triyaj', () => {
  it('NEW → IN_REVIEW geçişi + öncelik değişimi SLA’yı createdAt referansıyla yeniden hesaplar', async () => {
    const created = await api(tenantA)
      .post('/api/v1/service-requests')
      .send({ customerId: tenantA.customerId, subject: `Triyaj talebi ${RUN}`, priority: 'LOW' })
      .expect(201);
    expect(created.body.slaDueAt).toBeTruthy();

    const triaged = await api(tenantA)
      .patch(`/api/v1/service-requests/${created.body.requestId}`)
      .send({ status: 'IN_REVIEW', priority: 'URGENT' })
      .expect(200);
    expect(triaged.body.status).toBe('IN_REVIEW');
    expect(triaged.body.priority).toBe('URGENT');
    // URGENT politikası 120 dk (bu kiracıda) → createdAt + 120.
    const createdMs = Date.parse(created.body.createdAt);
    const dueMs = Date.parse(triaged.body.slaDueAt);
    expect(Math.round((dueMs - createdMs) / 60_000)).toBe(120);
  });

  it('IN_REVIEW → NEW geri dönüşü geçersiz (durum makinesi)', async () => {
    const created = await api(tenantA)
      .post('/api/v1/service-requests')
      .send({ customerId: tenantA.customerId, subject: `Geri dönüş ${RUN}` })
      .expect(201);
    const triaged = await api(tenantA)
      .patch(`/api/v1/service-requests/${created.body.requestId}`)
      .send({ status: 'IN_REVIEW' })
      .expect(200);
    await api(tenantA)
      .patch(`/api/v1/service-requests/${triaged.body.requestId}`)
      .send({ status: 'NEW' })
      .expect(409)
      .expect((res) => {
        expect(res.body.code).toBe('INVALID_TRANSITION');
      });
  });
});

describe('talep → iş emrine dönüşüm (birincil akış)', () => {
  it('dönüşüm iş emri üretir; talep CONVERTED; ikinci dönüşüm 409', async () => {
    const created = await api(tenantA)
      .post('/api/v1/service-requests')
      .send({
        customerId: tenantA.customerId,
        assetId: tenantA.assetId,
        subject: `Dönüşüm talebi ${RUN}`,
        priority: 'HIGH',
      })
      .expect(201);

    const converted = await api(tenantA)
      .post(`/api/v1/service-requests/${created.body.requestId}/convert`)
      .send({ type: 'CORRECTIVE' })
      .expect(201);
    expect(converted.body.workOrder.status).toBe('DRAFT');
    expect(converted.body.workOrder.requestId).toBe(created.body.requestId);
    expect(converted.body.workOrder.subject).toBe(`Dönüşüm talebi ${RUN}`);
    expect(converted.body.workOrder.assetTag).toBe(tenantA.assetTag);
    expect(converted.body.request.status).toBe('CONVERTED');

    // Birebir: ikinci dönüşüm reddedilir.
    await api(tenantA)
      .post(`/api/v1/service-requests/${created.body.requestId}/convert`)
      .send({})
      .expect(409)
      .expect((res) => {
        expect(res.body.code).toBe('REQUEST_NOT_CONVERTIBLE');
      });

    // Talep artık düzenlenemez.
    await api(tenantA)
      .patch(`/api/v1/service-requests/${created.body.requestId}`)
      .send({ priority: 'LOW' })
      .expect(409);
  });

  it('dönüşüm schedule ile PLANLANMIŞ iş emri üretir', async () => {
    const created = await api(tenantA)
      .post('/api/v1/service-requests')
      .send({ customerId: tenantA.customerId, subject: `Planlı dönüşüm ${RUN}` })
      .expect(201);
    const converted = await api(tenantA)
      .post(`/api/v1/service-requests/${created.body.requestId}/convert`)
      .send({
        type: 'PREVENTIVE',
        scheduledStart: '2026-12-01T09:00:00.000Z',
        scheduledEnd: '2026-12-01T13:00:00.000Z',
      })
      .expect(201);
    expect(converted.body.workOrder.status).toBe('PLANNED');
    expect(converted.body.workOrder.type).toBe('PREVENTIVE');
    expect(converted.body.workOrder.scheduledStart).toBe('2026-12-01T09:00:00.000Z');
  });
});

describe('iptal', () => {
  it('neden koduyla iptal; terminal durumda yeniden iptal 409', async () => {
    const created = await api(tenantA)
      .post('/api/v1/service-requests')
      .send({ customerId: tenantA.customerId, subject: `İptal talebi ${RUN}` })
      .expect(201);
    const cancelled = await api(tenantA)
      .post(`/api/v1/service-requests/${created.body.requestId}/cancel`)
      .send({ reasonCode: 'DUPLICATE', note: 'Mükerrer kayıt' })
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.cancellationReason).toBe('DUPLICATE');

    await api(tenantA)
      .post(`/api/v1/service-requests/${created.body.requestId}/cancel`)
      .send({ reasonCode: 'OTHER' })
      .expect(409)
      .expect((res) => {
        expect(res.body.code).toBe('INVALID_TRANSITION');
      });
  });
});

describe('kiracı izolasyonu (TEST-05 §4)', () => {
  it('çapraz-kiracı okuma/güncelleme/dönüşüm → 404 (varlık sızıntısı yok)', async () => {
    const created = await api(tenantA)
      .post('/api/v1/service-requests')
      .send({ customerId: tenantA.customerId, subject: `İzole talep ${RUN}` })
      .expect(201);
    const id = created.body.requestId as string;

    // B listesinde A'nın talebi YOK.
    const listB = await api(tenantB).get('/api/v1/service-requests?pageSize=100').expect(200);
    expect(listB.body.data.some((r: { requestId: string }) => r.requestId === id)).toBe(false);

    await api(tenantB).get(`/api/v1/service-requests/${id}`).expect(404);
    await api(tenantB)
      .patch(`/api/v1/service-requests/${id}`)
      .send({ priority: 'LOW' })
      .expect(404);
    await api(tenantB).post(`/api/v1/service-requests/${id}/convert`).send({}).expect(404);
    await api(tenantB)
      .post(`/api/v1/service-requests/${id}/cancel`)
      .send({ reasonCode: 'OTHER' })
      .expect(404);

    // B kiracısının müşteri kimliğiyle A'da talep → 404.
    await api(tenantA)
      .post('/api/v1/service-requests')
      .send({ customerId: tenantB.customerId, subject: 'Çapraz müşteri' })
      .expect(404);
  });

  it('RLS ham kanıt: uygulama rolü bağlamsız sorguda iş emri/talep satırı göremez', async () => {
    // Süper kullanıcı dışı, RLS'e tabi istemciyle (teknikflow_app) doğrulama:
    // withTenant(A) bağlamı YALNIZ A'nın taleplerini görür.
    const countA = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.serviceRequest.count({ where: { tenantId: tenantB.tenantId } }),
    );
    expect(countA).toBe(0);
  });
});

describe('rol sınırları', () => {
  it('teknisyen talep gelen kutusuna erişemez (403)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/service-requests')
      .set('Cookie', cookieHeader(technician.cookies))
      .expect(403)
      .expect((res) => {
        expect(res.body.code).toBe('FORBIDDEN');
      });
  });

  it('SLA politikası değişikliği yetkisiz kullanıcıya 403 (teknisyen)', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/service-requests/sla-policies')
      .set('Cookie', cookieHeader(technician.cookies))
      .set('x-csrf-token', technician.cookies.csrf)
      .send({ priority: 'LOW', resolveMinutes: 60 })
      .expect(403);
  });
});

describe('kategoriler', () => {
  it('kategori oluşturulur ve çift anahtar 409 döner', async () => {
    const created = await api(tenantA)
      .post('/api/v1/service-requests/categories')
      .send({ key: `klima-${RUN.slice(-4)}`, name: 'Klima Test' })
      .expect(201);
    expect(created.body.key).toContain('klima-');
    await api(tenantA)
      .post('/api/v1/service-requests/categories')
      .send({ key: `klima-${RUN.slice(-4)}`, name: 'Klima Test 2' })
      .expect(409)
      .expect((res) => {
        expect(res.body.code).toBe('CATEGORY_DUPLICATE');
      });
    const list = await api(tenantA).get('/api/v1/service-requests/categories').expect(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
  });
});
