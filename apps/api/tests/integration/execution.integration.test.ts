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
 * TEST-08 §3/§4 — SAHA YÜRÜTME entegrasyon testleri.
 *
 * Kabul kriterleri kanıtı:
 * - Permission denied / manual fallback (GPS izni yok → MANUAL visit)
 * - GPS accuracy metadata (GPS visit doğruluk + capturedAt taşınır)
 * - Airplane mode / duplicate sync (Idempotency-Key replay)
 * - Media retry (init replay + complete replay)
 * - Signature append-only (düzeltme = yeni kayıt + bağ)
 *
 * Ayrıca: kanıt kapıları (COMPLETE ← checklist; CLOSED ← müşteri imzası),
 * kiracı izolasyonu (tüm alt kaynaklarda 404), rol sınırları, rapor.
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
  tenant: { cookies: { session: string; csrf: string } },
  local: string,
  roleKey: string,
) {
  const inviteeEmail = email(local);
  const invitation = await request(app.getHttpServer())
    .post('/api/v1/tenants/current/invitations')
    .set('Cookie', cookieHeader(tenant.cookies))
    .set('x-csrf-token', tenant.cookies.csrf)
    .send({ email: inviteeEmail, roleKey })
    .expect(201);
  const accept = await request(app.getHttpServer())
    .post(`/api/v1/invitations/${invitation.body.inviteToken}/accept`)
    .send({ password: PASSWORD, displayName: 'Saha Kullanıcı' })
    .expect(200);
  return { email: inviteeEmail, cookies: extractCookies(accept) };
}

interface TenantCtx {
  tenantId: string;
  cookies: { session: string; csrf: string };
  customerId?: string;
}

function api(cookies: { session: string; csrf?: string }) {
  const withHeaders = (test: request.Test): request.Test =>
    test.set('Cookie', cookieHeader(cookies)).set('x-csrf-token', cookies.csrf);
  return {
    get: (url: string) => withHeaders(request(app.getHttpServer()).get(url)),
    post: (url: string) => withHeaders(request(app.getHttpServer()).post(url)),
    patch: (url: string) => withHeaders(request(app.getHttpServer()).patch(url)),
    put: (url: string) => withHeaders(request(app.getHttpServer()).put(url)),
    delete: (url: string) => withHeaders(request(app.getHttpServer()).delete(url)),
  };
}

let tenantA: TenantCtx;
let tenantB: TenantCtx;
let technician: { userId: string; cookies: { session: string; csrf: string } };
let finance: { cookies: { session: string; csrf: string } };
const workOrders: Record<string, string> = {};

async function createWorkOrder(cookies: { session: string; csrf: string }, key: string) {
  const response = await api(cookies)
    .post('/api/v1/work-orders')
    .send({
      customerId: tenantA.customerId,
      subject: `Yürütme testi ${key} ${RUN}`,
      description: 'TEST-08 saha yürütme senaryosu',
      priority: 'HIGH',
      type: 'CORRECTIVE',
    })
    .expect(201);
  workOrders[key] = response.body.workOrderId as string;
  return response.body as { workOrderId: string; workOrderNo: string; version: number };
}

async function driveToInProgress(
  cookies: { session: string; csrf: string },
  workOrderId: string,
  location?: unknown,
) {
  // PLAN → ASSIGN (teknisyen) → ACCEPT → EN_ROUTE → ARRIVE(+GPS) → START_WORK
  await api(cookies)
    .post(`/api/v1/work-orders/${workOrderId}/transition`)
    .send({ to: 'PLANNED' })
    .expect(201);
  await api(cookies)
    .post(`/api/v1/work-orders/${workOrderId}/transition`)
    .send({ to: 'ASSIGNED', assigneeUserId: technician.userId })
    .expect(201);
  for (const to of ['ACCEPTED', 'EN_ROUTE']) {
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/transition`)
      .send({ to })
      .expect(201);
  }
  await api(technician.cookies)
    .post(`/api/v1/work-orders/${workOrderId}/transition`)
    .send({ to: 'ON_SITE', ...(location ? { location } : {}) })
    .expect(201);
  await api(technician.cookies)
    .post(`/api/v1/work-orders/${workOrderId}/transition`)
    .send({ to: 'IN_PROGRESS' })
    .expect(201);
}

/** Geçerli küçük PNG (magic-byte imzası + dolgu). */
function pngBytes(size = 64): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, Buffer.alloc(Math.max(0, size - 8), 0x11)]);
}

const GPS_LOCATION = {
  latitude: 41.0082,
  longitude: 28.9784,
  accuracyMeters: 7.5,
  capturedAt: '2026-11-10T09:15:00.000Z',
  source: 'GPS',
};

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

  const a = await signup('YurutmeA');
  const b = await signup('YurutmeB');
  tenantA = { tenantId: a.response.body.membership.tenantId, cookies: a.cookies };
  tenantB = { tenantId: b.response.body.membership.tenantId, cookies: b.cookies };

  const customer = await api(tenantA.cookies)
    .post('/api/v1/customers')
    .send({
      name: `Yürütme Müşteri ${RUN}`,
      customerType: 'COMPANY',
      primaryContact: { name: 'Kontak Kişi', email: email('kontak') },
    })
    .expect(201);
  tenantA.customerId = customer.body.customerId as string;

  const tech = await addMember(tenantA, 'teknisyen', 'technician');
  const fin = await addMember(tenantA, 'finans', 'finance');
  const techMembership = await scoped.withTenant(tenantA.tenantId, (tx) =>
    tx.membership.findFirst({
      where: { tenantId: tenantA.tenantId, user: { emailNormalized: tech.email.toLowerCase() } },
      select: { userId: true },
    }),
  );
  technician = { userId: techMembership!.userId, cookies: tech.cookies };
  finance = { cookies: fin.cookies };
});

afterAll(async () => {
  if (app) await app.close();
});

describe('TEST-08 — saha yürütme: kabul kriterleri', () => {
  it('GPS varış: visit doğruluk meta verisiyle kaydedilir', async () => {
    const wo = await createWorkOrder(tenantA.cookies, 'gps');
    await driveToInProgress(tenantA.cookies, wo.workOrderId, GPS_LOCATION);

    const visits = await api(technician.cookies)
      .get(`/api/v1/work-orders/${wo.workOrderId}/visits`)
      .expect(200);
    expect(visits.body.data).toHaveLength(1);
    const checkIn = visits.body.data[0];
    expect(checkIn.visitType).toBe('CHECK_IN');
    expect(checkIn.source).toBe('GPS');
    expect(checkIn.accuracyMeters).toBeCloseTo(7.5);
    expect(checkIn.latitude).toBeCloseTo(41.0082);
    expect(checkIn.capturedAt).toBe('2026-11-10T09:15:00.000Z');
    expect(checkIn.recordedById).toBe(technician.userId);
  });

  it('izin reddi fallback: konumsuz varış MANUAL visit ile kaydedilir', async () => {
    const wo = await createWorkOrder(tenantA.cookies, 'nogps');
    await driveToInProgress(tenantA.cookies, wo.workOrderId, undefined);

    const visits = await api(technician.cookies)
      .get(`/api/v1/work-orders/${wo.workOrderId}/visits`)
      .expect(200);
    expect(visits.body.data).toHaveLength(1);
    expect(visits.body.data[0]).toMatchObject({
      visitType: 'CHECK_IN',
      source: 'MANUAL',
      manualReason: 'Konum paylaşılmadı',
      latitude: null,
      accuracyMeters: null,
    });
  });

  it('manuel konum: neden zorunlu — MANUAL + reason kabul edilir', async () => {
    const wo = await createWorkOrder(tenantA.cookies, 'manual');
    await driveToInProgress(tenantA.cookies, wo.workOrderId, {
      latitude: 41.0,
      longitude: 29.0,
      capturedAt: '2026-11-10T08:00:00.000Z',
      source: 'MANUAL',
      manualReason: 'GPS izni verilmedi',
    });
    const visits = await api(technician.cookies)
      .get(`/api/v1/work-orders/${wo.workOrderId}/visits`)
      .expect(200);
    expect(visits.body.data[0]).toMatchObject({
      source: 'MANUAL',
      manualReason: 'GPS izni verilmedi',
      latitude: 41.0,
    });
  });

  it('checklist: madde ekleme, tip yanlışı 400, geçerli yanıt 200', async () => {
    const wo = await createWorkOrder(tenantA.cookies, 'checklist');
    await driveToInProgress(tenantA.cookies, wo.workOrderId, GPS_LOCATION);

    // Teknisyen (complete + atanan) madde ekleyebilir.
    const booleanItem = await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/checklist/items`)
      .send({ label: 'Enerji kesildi mi?', responseType: 'BOOLEAN', required: true })
      .expect(201);
    const numberItem = await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/checklist/items`)
      .send({ label: 'Basınç değeri (bar)', responseType: 'NUMBER' })
      .expect(201);
    const selectItem = await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/checklist/items`)
      .send({ label: 'Filtre durumu', responseType: 'SINGLE_SELECT', options: ['Temiz', 'Kirli'] })
      .expect(201);

    // Yanlış tip → 400.
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/checklist/responses`)
      .send({ responses: [{ checklistItemId: booleanItem.body.checklistItemId, value: 'evet' }] })
      .expect(400);
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/checklist/responses`)
      .send({
        responses: [{ checklistItemId: selectItem.body.checklistItemId, value: 'Bilinmiyor' }],
      })
      .expect(400);

    // Geçerli toplu yanıt.
    const ok = await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/checklist/responses`)
      .send({
        responses: [
          { checklistItemId: booleanItem.body.checklistItemId, value: true },
          { checklistItemId: numberItem.body.checklistItemId, value: 6.2 },
          { checklistItemId: selectItem.body.checklistItemId, value: 'Temiz' },
        ],
      })
      .expect(201);
    expect(ok.body.data).toHaveLength(3);
    const byId = new Map(
      ok.body.data.map((item: { checklistItemId: string }) => [item.checklistItemId, item]),
    );
    expect(byId.get(booleanItem.body.checklistItemId).responseValue).toBe(true);
    expect(byId.get(numberItem.body.checklistItemId).responseValue).toBe(6.2);
    expect(byId.get(numberItem.body.checklistItemId).respondedById).toBe(technician.userId);

    // Tekrar aynı set — idempotency anahtarsız da alan güncellemesi güvenli.
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/checklist/responses`)
      .send({ responses: [{ checklistItemId: booleanItem.body.checklistItemId, value: false }] })
      .expect(201);

    // Başka iş emrinin maddesi → 404 (varlık sızıntısı yok).
    const other = await createWorkOrder(tenantA.cookies, 'other');
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${other.workOrderId}/checklist/responses`)
      .send({ responses: [{ checklistItemId: booleanItem.body.checklistItemId, value: true }] })
      .expect(404);
  });

  it('işçilik: süre sunucuda türetilir; ters/sınıf dışı aralık 400', async () => {
    const wo = createWorkOrder.name; // eslint önlemi
    void wo;
    const target = workOrders['checklist']!;

    const entry = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/labor`)
      .send({
        startedAt: '2026-11-10T10:00:00.000Z',
        endedAt: '2026-11-10T11:30:00.000Z',
        note: 'Motor sökümü',
      })
      .expect(201);
    expect(entry.body.durationMinutes).toBe(90);
    expect(entry.body.userId).toBe(technician.userId);

    await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/labor`)
      .send({ startedAt: '2026-11-10T12:00:00.000Z', endedAt: '2026-11-10T11:00:00.000Z' })
      .expect(400);
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/labor`)
      .send({
        startedAt: '2026-11-10T10:00:00.000Z',
        endedAt: '2026-11-12T10:00:00.000Z',
      })
      .expect(400);

    const list = await api(technician.cookies)
      .get(`/api/v1/work-orders/${target}/labor`)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('medya: init → imzalı PUT → complete (READY + checksum); hatalı içerik REJECTED', async () => {
    const target = workOrders['checklist']!;
    const init = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/attachments/init`)
      .send({ kind: 'PHOTO', fileName: 'pano.png', contentType: 'image/png', sizeBytes: 64 })
      .expect(201);
    expect(init.body.uploadUrl).toContain('http');
    expect(init.body.requiredHeaders['content-type']).toBe('image/png');

    // PUT — imzalı URL ile gerçek RustFS gidiş-dönüşü.
    const put = await fetch(init.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: pngBytes(64),
    });
    expect(put.status).toBeLessThan(300);

    const complete = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/attachments/${init.body.attachmentId}/complete`)
      .expect(201);
    expect(complete.body.state).toBe('READY');
    expect(complete.body.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(complete.body.viewUrl).toContain('http');

    // Yanlış magic byte: PNG yerine rastgele → REJECTED (karantina).
    const badInit = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/attachments/init`)
      .send({ kind: 'PHOTO', fileName: 'sahte.png', contentType: 'image/png', sizeBytes: 32 })
      .expect(201);
    await fetch(badInit.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: Buffer.alloc(32, 0x00),
    });
    const badComplete = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/attachments/${badInit.body.attachmentId}/complete`)
      .expect(201);
    expect(badComplete.body.state).toBe('REJECTED');
    expect(badComplete.body.viewUrl).toBeNull();

    const list = await api(technician.cookies)
      .get(`/api/v1/work-orders/${target}/attachments`)
      .expect(200);
    expect(list.body.data).toHaveLength(2);
  });

  it('medya retry / duplicate sync: init ve complete replay aynı yanıtı döner', async () => {
    const target = workOrders['checklist']!;
    const key = crypto.randomUUID();
    const first = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/attachments/init`)
      .set('idempotency-key', key)
      .send({ kind: 'PHOTO', fileName: 'retry.png', contentType: 'image/png', sizeBytes: 64 })
      .expect(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const replay = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/attachments/init`)
      .set('idempotency-key', key)
      .send({ kind: 'PHOTO', fileName: 'retry.png', contentType: 'image/png', sizeBytes: 64 })
      .expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.attachmentId).toBe(first.body.attachmentId);

    // Farklı gövde + aynı anahtar → 409.
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/attachments/init`)
      .set('idempotency-key', key)
      .send({ kind: 'PHOTO', fileName: 'baska.png', contentType: 'image/png', sizeBytes: 64 })
      .expect(409);

    // Complete replay: aynı anahtarla iki kez.
    await fetch(first.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: pngBytes(64),
    });
    const completeKey = crypto.randomUUID();
    const c1 = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/attachments/${first.body.attachmentId}/complete`)
      .set('idempotency-key', completeKey)
      .expect(201);
    const c2 = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/attachments/${first.body.attachmentId}/complete`)
      .set('idempotency-key', completeKey)
      .expect(201);
    expect(c2.headers['idempotency-replayed']).toBe('true');
    expect(c2.body.state).toBe('READY');
  });

  it('duplicate sync: işçilik replay tek satır bırakır', async () => {
    const target = workOrders['checklist']!;
    const key = crypto.randomUUID();
    const body = {
      startedAt: '2026-11-10T13:00:00.000Z',
      endedAt: '2026-11-10T13:45:00.000Z',
      note: 'Uçak modu kuyruğundan',
    };
    const first = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/labor`)
      .set('idempotency-key', key)
      .send(body)
      .expect(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const replay = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/labor`)
      .set('idempotency-key', key)
      .send(body)
      .expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.timeEntryId).toBe(first.body.timeEntryId);

    const list = await api(technician.cookies)
      .get(`/api/v1/work-orders/${target}/labor`)
      .expect(200);
    const matching = list.body.data.filter(
      (entry: { note: string | null }) => entry.note === 'Uçak modu kuyruğundan',
    );
    expect(matching).toHaveLength(1);
  });

  it('imza: müşteri imzası alınır; append-only (güncelleme ucu yok); düzeltme yeni kayıt', async () => {
    const target = workOrders['checklist']!;
    const strokes = [
      [
        { x: 10, y: 20 },
        { x: 40, y: 24 },
        { x: 80, y: 30 },
      ],
    ];
    const signature = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/signatures`)
      .set('idempotency-key', crypto.randomUUID())
      .send({
        signedBy: 'CUSTOMER',
        signerName: 'Deniz Aydın',
        strokes,
        capturedAt: '2026-11-10T11:00:00.000Z',
      })
      .expect(201);
    expect(signature.body.signedBy).toBe('CUSTOMER');
    expect(signature.body.strokes).toEqual(strokes);

    // Append-only: PATCH/DELETE uçları tasarım gereği yok (405/404).
    await api(technician.cookies)
      .patch(`/api/v1/work-orders/${target}/signatures/${signature.body.signatureId}`)
      .send({ signerName: 'Değiştirilen' })
      .expect(404);
    await api(technician.cookies)
      .delete(`/api/v1/work-orders/${target}/signatures/${signature.body.signatureId}`)
      .expect(404);

    // Düzeltme imzası: yeni kayıt + correctionOfSignatureId bağı.
    const correction = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/signatures`)
      .send({
        signedBy: 'CUSTOMER',
        signerName: 'Deniz Aydın (düzeltme)',
        strokes,
        capturedAt: '2026-11-10T11:05:00.000Z',
        correctionOfSignatureId: signature.body.signatureId,
      })
      .expect(201);
    expect(correction.body.correctionOfSignatureId).toBe(signature.body.signatureId);

    const signatures = await api(technician.cookies)
      .get(`/api/v1/work-orders/${target}/signatures`)
      .expect(200);
    expect(signatures.body.data).toHaveLength(2); // iki kayıt da durur

    // Signature replay — duplicate sync.
    const key = crypto.randomUUID();
    const payload = {
      signedBy: 'TECHNICIAN',
      signerName: 'Teknisyen İmzası',
      strokes,
      capturedAt: '2026-11-10T11:10:00.000Z',
    };
    const s1 = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/signatures`)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201);
    const s2 = await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/signatures`)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201);
    expect(s2.headers['idempotency-replayed']).toBe('true');
    expect(s2.body.signatureId).toBe(s1.body.signatureId);
    const finalCount = await api(technician.cookies)
      .get(`/api/v1/work-orders/${target}/signatures`)
      .expect(200);
    expect(finalCount.body.data).toHaveLength(3);
  });

  it('kanıt kapısı: zorunlu checklist yanıtlanmadan COMPLETE 409 EVIDENCE_MISSING', async () => {
    const wo = await createWorkOrder(tenantA.cookies, 'gate');
    await driveToInProgress(tenantA.cookies, wo.workOrderId, GPS_LOCATION);

    await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/checklist/items`)
      .send({ label: 'Emniyet kontrolü', responseType: 'BOOLEAN', required: true })
      .expect(201);

    const blocked = await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/transition`)
      .send({ to: 'COMPLETED' })
      .expect(409);
    expect(blocked.body.code).toBe('EVIDENCE_MISSING');
    expect(blocked.body.missing).toHaveLength(1);

    // Yanıtla → tamamlama geçer (MANUEL check-out + neden).
    const items = await api(technician.cookies)
      .get(`/api/v1/work-orders/${wo.workOrderId}/checklist`)
      .expect(200);
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/checklist/responses`)
      .send({
        responses: [{ checklistItemId: items.body.data[0].checklistItemId, value: true }],
      })
      .expect(201);
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${wo.workOrderId}/transition`)
      .send({
        to: 'COMPLETED',
        location: {
          latitude: 41.0,
          longitude: 29.0,
          capturedAt: '2026-11-10T12:00:00.000Z',
          source: 'MANUAL',
          manualReason: 'Servis asansöründe sinyal yok',
        },
      })
      .expect(201);

    // Check-out visit da yazıldı.
    const visits = await api(technician.cookies)
      .get(`/api/v1/work-orders/${wo.workOrderId}/visits`)
      .expect(200);
    expect(visits.body.data.map((v: { visitType: string }) => v.visitType)).toEqual([
      'CHECK_IN',
      'CHECK_OUT',
    ]);
    expect(visits.body.data[1].manualReason).toBe('Servis asansöründe sinyal yok');
  });

  it('kanıt kapısı: müşteri imzası olmadan CLOSE 409 EVIDENCE_MISSING', async () => {
    const target = workOrders['gate']!;
    const blocked = await api(tenantA.cookies)
      .post(`/api/v1/work-orders/${target}/transition`)
      .send({ to: 'CLOSED' })
      .expect(409);
    expect(blocked.body.code).toBe('EVIDENCE_MISSING');

    // Teknisyen imzası yeterli DEĞİL — müşteri onayı gerekli.
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/signatures`)
      .send({
        signedBy: 'TECHNICIAN',
        signerName: 'Teknisyen',
        strokes: [
          [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        ],
        capturedAt: '2026-11-10T12:10:00.000Z',
      })
      .expect(201);
    await api(tenantA.cookies)
      .post(`/api/v1/work-orders/${target}/transition`)
      .send({ to: 'CLOSED' })
      .expect(409);

    await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/signatures`)
      .send({
        signedBy: 'CUSTOMER',
        signerName: 'Kapı Yetkilisi',
        strokes: [
          [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        ],
        capturedAt: '2026-11-10T12:15:00.000Z',
      })
      .expect(201);
    await api(tenantA.cookies)
      .post(`/api/v1/work-orders/${target}/transition`)
      .send({ to: 'CLOSED' })
      .expect(201);

    // Terminal: kanıt yazımı kapanır.
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/labor`)
      .send({ startedAt: '2026-11-10T13:00:00.000Z', endedAt: '2026-11-10T13:30:00.000Z' })
      .expect(409);
  });

  it('kiracı izolasyonu: tüm alt kaynaklar çapraz-kiracıya 404', async () => {
    const target = workOrders['checklist']!;
    const attachmentList = await api(technician.cookies)
      .get(`/api/v1/work-orders/${target}/attachments`)
      .expect(200);
    const attachmentId = attachmentList.body.data[0].attachmentId;

    await api(tenantB.cookies).get(`/api/v1/work-orders/${target}/checklist`).expect(404);
    await api(tenantB.cookies).get(`/api/v1/work-orders/${target}/labor`).expect(404);
    await api(tenantB.cookies).get(`/api/v1/work-orders/${target}/visits`).expect(404);
    await api(tenantB.cookies).get(`/api/v1/work-orders/${target}/attachments`).expect(404);
    await api(tenantB.cookies).get(`/api/v1/work-orders/${target}/signatures`).expect(404);
    await api(tenantB.cookies).get(`/api/v1/work-orders/${target}/report`).expect(404);
    await api(tenantB.cookies)
      .post(`/api/v1/work-orders/${target}/labor`)
      .send({ startedAt: '2026-11-10T10:00:00.000Z', endedAt: '2026-11-10T10:30:00.000Z' })
      .expect(404);
    await api(tenantB.cookies)
      .post(`/api/v1/work-orders/${target}/attachments/${attachmentId}/complete`)
      .expect(404);
    await api(tenantB.cookies)
      .post(`/api/v1/work-orders/${target}/signatures`)
      .send({
        signedBy: 'CUSTOMER',
        signerName: 'B Kiracı',
        strokes: [
          [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        ],
        capturedAt: '2026-11-10T12:00:00.000Z',
      })
      .expect(404);
  });

  it('rol sınırı: finans (view_all) okur; kanıt yazamaz (403)', async () => {
    const target = workOrders['gps']!;
    await api(technician.cookies)
      .post(`/api/v1/work-orders/${target}/checklist/items`)
      .send({ label: 'Sadece okuma testi', responseType: 'BOOLEAN' })
      .expect(201);

    await api(finance.cookies).get(`/api/v1/work-orders/${target}/checklist`).expect(200);
    await api(finance.cookies).get(`/api/v1/work-orders/${target}/report`).expect(200);
    await api(finance.cookies)
      .post(`/api/v1/work-orders/${target}/labor`)
      .send({ startedAt: '2026-11-10T10:00:00.000Z', endedAt: '2026-11-10T10:30:00.000Z' })
      .expect(403);
    await api(finance.cookies)
      .post(`/api/v1/work-orders/${target}/checklist/items`)
      .send({ label: 'Finans maddesi', responseType: 'BOOLEAN' })
      .expect(403);
    await api(finance.cookies)
      .post(`/api/v1/work-orders/${target}/signatures`)
      .send({
        signedBy: 'CUSTOMER',
        signerName: 'Finans Kullanıcısı',
        strokes: [
          [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        ],
        capturedAt: '2026-11-10T12:00:00.000Z',
      })
      .expect(403);
  });

  it('rapor önizlemesi: tüm kanıt bölümleri birarada', async () => {
    const target = workOrders['checklist']!;
    const report = await api(technician.cookies)
      .get(`/api/v1/work-orders/${target}/report`)
      .expect(200);
    expect(report.body.workOrderNo).toMatch(/^WO-\d{4}-\d{4}$/);
    expect(report.body.customerName).toContain('Yürütme Müşteri');
    expect(report.body.visits.length).toBeGreaterThanOrEqual(1);
    expect(report.body.checklist.length).toBe(3);
    expect(report.body.labor.length).toBeGreaterThanOrEqual(2);
    expect(report.body.attachments.length).toBeGreaterThanOrEqual(2);
    expect(report.body.signatures.length).toBe(3);
    expect(report.body.totalLaborMinutes).toBeGreaterThanOrEqual(90);
    expect(report.body.generatedAt).toBeTruthy();
  });
});
