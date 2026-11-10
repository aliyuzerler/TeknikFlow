import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/common/configure-app.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { seedPlans, seedRbacCatalogue } from '../../src/rbac/rbac-catalogue.seed.js';
import { resetEnvCache, getEnv } from '../../src/config/env.js';
import { REDIS_CLIENT } from '../../src/redis/redis.module.js';
import type { Redis } from 'ioredis';

/**
 * TEST-08 §3-§4 — Faz 08 saha yürütme uçtan uca (gerçek DB/Redis/RustFS).
 *
 * Kabul kriterleri: izin reddi/manuel geri dönüş, GPS doğruluk meta'sı,
 * çift senkron (idempotency oynatma), medya yeniden deneme ve imzanın
 * ekle-güncelle-yok davranışı. Test verisi ÇALIŞMA ANINDA üretilir.
 */

const RUN = Date.now().toString(36);
const email = (local: string) => `${local}.${RUN}@test.example`;
const PASSWORD = 'SahaServis2026';

let app: INestApplication;
let prisma: PrismaService;

interface TenantCtx {
  tenantId: string;
  slug: string;
  cookies: { session: string; csrf: string };
  customerId: string;
}

let tenantA: TenantCtx;
let tenantB: TenantCtx;
let tech1: { userId: string; cookies: { session: string; csrf: string } };
let warehouseUser: { userId: string; cookies: { session: string; csrf: string } };

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

function authed(cookies: { session: string; csrf: string }) {
  const withHeaders = (req: request.Test) =>
    req.set('Cookie', cookieHeader(cookies)).set('x-csrf-token', cookies.csrf);
  return {
    get: (url: string) => withHeaders(request(app.getHttpServer()).get(url)),
    post: (url: string) => withHeaders(request(app.getHttpServer()).post(url)),
    patch: (url: string) => withHeaders(request(app.getHttpServer()).patch(url)),
    put: (url: string) => withHeaders(request(app.getHttpServer()).put(url)),
  };
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
    .send({ password: PASSWORD, displayName: 'Davetli Kullanıcı' })
    .expect(200);
  return {
    email: inviteeEmail,
    userId: accept.body.user.userId as string,
    cookies: extractCookies(accept),
  };
}

/** Saha yürütme durumuna (EN_ROUTE) kadar taşıyan hazır akış.
 * Zaman penceresi her çağrıda BENZERSİZ: tech1'e çift rezervasyon
 * çakışma denetimi (Faz 06) aynı pencerede ikinci atamayı reddeder. */
let windowSeq = 0;
async function createAssignedInProgressWorkOrder(tenant: TenantCtx) {
  windowSeq += 1;
  const day = 5 + windowSeq; // 2026-12-05'ten itibaren günlük kaydırma
  const dayStr = String(day).padStart(2, '0');
  const created = await authed(tenant.cookies)
    .post('/api/v1/work-orders')
    .send({
      customerId: tenant.customerId,
      subject: `Yürütme ${RUN}-${windowSeq}`,
      priority: 'HIGH',
    })
    .expect(201);
  const workOrderId = created.body.workOrderId as string;
  const owner = tenant.cookies;
  await transition(owner, workOrderId, {
    to: 'PLANNED',
    scheduledStart: `2026-12-${dayStr}T09:00:00.000Z`,
    scheduledEnd: `2026-12-${dayStr}T13:00:00.000Z`,
  });
  await transition(owner, workOrderId, { to: 'ASSIGNED', assigneeUserId: tech1.userId });
  await transition(tech1.cookies, workOrderId, { to: 'ACCEPTED' });
  await transition(tech1.cookies, workOrderId, { to: 'EN_ROUTE' });
  return workOrderId;
}

async function transition(
  cookies: { session: string; csrf: string },
  workOrderId: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return authed(cookies).post(`/api/v1/work-orders/${workOrderId}/transition`).send(body);
}

const GPS_LOCATION = {
  latitude: 41.0082,
  longitude: 28.9784,
  accuracyMeters: 12.5,
  capturedAt: '2026-11-10T09:30:00.000Z',
  source: 'GPS',
};

const MANUAL_LOCATION = {
  capturedAt: '2026-11-10T09:35:00.000Z',
  source: 'MANUAL',
  manualReason: 'Konum izni reddedildi',
};

function signatureBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: 'CUSTOMER',
    signerName: 'Ayşe Yılmaz',
    signedAt: '2026-11-10T12:00:00.000Z',
    strokes: [
      [
        { x: 0.1, y: 0.2, t: 0 },
        { x: 0.2, y: 0.25, t: 40 },
        { x: 0.3, y: 0.3, t: 80 },
        { x: 0.4, y: 0.32, t: 120 },
      ],
    ],
    ...over,
  };
}

/** Küçük geçerli JPEG (magic byte FF D8 FF + kuyruk). */
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);
/** SVG yerine metin — magic byte eşleşmeyi İSTEMEZ ( reddedilmeli). */
const TEXT_BYTES = Buffer.from('<?xml version="1.0"?><svg onload="alert(1)">');

beforeAll(async () => {
  resetEnvCache();
  getEnv().AUTH_RATE_LIMIT_MAX = 1000;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  prisma = app.get(PrismaService);
  const redis = app.get<Redis>(REDIS_CLIENT);
  const keys = await redis.keys('rl:*');
  if (keys.length > 0) await redis.del(...keys);

  await seedRbacCatalogue(prisma);
  await seedPlans(prisma);

  const a = await signup('YurutmeA');
  const b = await signup('YurutmeB');
  tenantA = {
    tenantId: a.response.body.membership.tenantId,
    slug: a.response.body.membership.tenantSlug,
    cookies: a.cookies,
    customerId: '',
  };
  tenantB = {
    tenantId: b.response.body.membership.tenantId,
    slug: b.response.body.membership.tenantSlug,
    cookies: b.cookies,
    customerId: '',
  };
  for (const tenant of [tenantA, tenantB]) {
    const customer = await authed(tenant.cookies)
      .post('/api/v1/customers')
      .send({ name: `Yürütme Müşteri ${RUN} ${tenant.tenantId.slice(0, 4)}` })
      .expect(201);
    tenant.customerId = customer.body.customerId as string;
  }

  tech1 = await addMember(tenantA, 'tech-exec', 'technician');
  warehouseUser = await addMember(tenantA, 'warehouse-exec', 'warehouse');
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('GPS kilometre taşları ve varış kaydı', () => {
  it('ON_SITE konum olmadan sözleşme reddi (400) — GPS zorunlu', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    const response = await transition(tech1.cookies, workOrderId, { to: 'ON_SITE' });
    expect(response.status).toBe(400);
  });

  it('GPS varışı: koordinat + doğruluk meta verisi ziyaret kaydına yazılır', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    const response = await transition(tech1.cookies, workOrderId, {
      to: 'ON_SITE',
      location: GPS_LOCATION,
    });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ON_SITE');

    const report = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders/${workOrderId}/report`)
      .expect(200);
    expect(report.body.visits).toHaveLength(1);
    const visit = report.body.visits[0];
    expect(visit.milestone).toBe('ARRIVED');
    expect(visit.source).toBe('GPS');
    expect(visit.latitude).toBeCloseTo(41.0082);
    expect(visit.longitude).toBeCloseTo(28.9784);
    expect(visit.accuracyMeters).toBe(12.5);
  });

  it('İzin reddi geri dönüşü: manuel onay + nedenle varış (koordinatsız)', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    const response = await transition(tech1.cookies, workOrderId, {
      to: 'ON_SITE',
      location: MANUAL_LOCATION,
    });
    expect(response.status).toBe(201);

    const report = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders/${workOrderId}/report`)
      .expect(200);
    const visit = report.body.visits[0];
    expect(visit.milestone).toBe('ARRIVED');
    expect(visit.source).toBe('MANUAL');
    expect(visit.manualReason).toBe('Konum izni reddedildi');
    expect(visit.latitude).toBeNull();
  });

  it('MANUEL kaynakta neden yoksa sözleşme reddi', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    const response = await transition(tech1.cookies, workOrderId, {
      to: 'ON_SITE',
      location: { capturedAt: '2026-11-10T09:35:00.000Z', source: 'MANUAL' },
    });
    expect(response.status).toBe(400);
  });
});

describe('Checklist ve kanıt kapısı (COMPLETED)', () => {
  it('zorunlu madde eksikken COMPLETED → 409 EVIDENCE_MISSING + eksik listesi', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });
    await transition(tech1.cookies, workOrderId, { to: 'IN_PROGRESS' });

    const item = await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/checklist-items`)
      .send({ label: 'Emniyet kilidi testi', required: true })
      .expect(201);
    expect(item.body.required).toBe(true);

    const blocked = await transition(tech1.cookies, workOrderId, { to: 'COMPLETED' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('EVIDENCE_MISSING');
    expect(blocked.body.details.gate).toBe('COMPLETED');
    expect(blocked.body.missing).toEqual([
      { itemId: item.body.itemId, label: 'Emniyet kilidi testi' },
    ]);

    // Teknisyen maddenin üzerinden gelir → kapı açılır.
    await authed(tech1.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}/checklist-items/${item.body.itemId}`)
      .send({ done: true, note: 'Ölçüm tamam' })
      .expect(200);

    const completed = await transition(tech1.cookies, workOrderId, { to: 'COMPLETED' });
    expect(completed.status).toBe(201);
  });

  it('opsiyonel madde eksikken COMPLETED engellenmez', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });
    await transition(tech1.cookies, workOrderId, { to: 'IN_PROGRESS' });
    await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/checklist-items`)
      .send({ label: 'Yedek açıklama (opsiyonel)', required: false })
      .expect(201);

    const completed = await transition(tech1.cookies, workOrderId, { to: 'COMPLETED' });
    expect(completed.status).toBe(201);
  });

  it('çift tamamlama gönderimi idempotent — durum görünümü değişmez', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });
    const item = await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/checklist-items`)
      .send({ label: 'Basınç testi' })
      .expect(201);

    const first = await authed(tech1.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}/checklist-items/${item.body.itemId}`)
      .send({ done: true });
    expect(first.status).toBe(200);
    expect(first.body.done).toBe(true);
    expect(first.body.doneByName).toBe('Davetli Kullanıcı');

    const second = await authed(tech1.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}/checklist-items/${item.body.itemId}`)
      .send({ done: true });
    expect(second.status).toBe(200);
    expect(second.body.doneAt).toBe(first.body.doneAt);

    // Geri alma → done temizlenir.
    const reopened = await authed(tech1.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}/checklist-items/${item.body.itemId}`)
      .send({ done: false });
    expect(reopened.body.done).toBe(false);
    expect(reopened.body.doneAt).toBeNull();
  });

  it('çalışma yetkisi olmayan kullanıcı (depo) madde tamamlayamaz — 403', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });
    const item = await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/checklist-items`)
      .send({ label: 'Yetki testi' })
      .expect(201);

    const response = await authed(warehouseUser.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}/checklist-items/${item.body.itemId}`)
      .send({ done: true });
    expect(response.status).toBe(403);
  });
});

describe('Süre kayıtları ve işgücü özeti', () => {
  it('aç → durdur; ikinci açılış 409 TIME_ENTRY_ALREADY_OPEN', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });
    await transition(tech1.cookies, workOrderId, { to: 'IN_PROGRESS' });

    const start = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/time-entries`)
      .send({ type: 'LABOR', startedAt: '2026-11-10T09:00:00.000Z' })
      .expect(201);
    expect(start.body.status).toBe('OPEN');
    expect(start.body.durationMinutes).toBeNull();

    const duplicate = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/time-entries`)
      .send({ type: 'TRAVEL', startedAt: '2026-11-10T09:05:00.000Z' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('TIME_ENTRY_ALREADY_OPEN');

    const stopped = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/time-entries/${start.body.timeEntryId}/stop`)
      .send({ endedAt: '2026-11-10T10:30:00.000Z' })
      .expect(201);
    expect(stopped.body.status).toBe('CLOSED');
    expect(stopped.body.durationMinutes).toBe(90);

    // Çift durdurma → idempotent no-op.
    const stopAgain = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/time-entries/${start.body.timeEntryId}/stop`)
      .send({ endedAt: '2026-11-10T11:00:00.000Z' })
      .expect(201);
    expect(stopAgain.body.endedAt).toBe(stopped.body.endedAt);

    // Rapor işgücü özeti: 90 dk LABOR.
    const report = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders/${workOrderId}/report`)
      .expect(200);
    expect(report.body.labor).toEqual({
      travelMinutes: 0,
      laborMinutes: 90,
      waitingMinutes: 0,
      totalMinutes: 90,
      openEntry: false,
    });
  });
});

describe('İmza — ekle-güncelle-yok + idempotency oynatma', () => {
  it('idempotency anahtarıyla çift gönderim: TEK satır + oynatma başlığı', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });

    const key = '11111111-1111-4111-8111-111111111111';
    const first = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .set('x-idempotency-key', key)
      .send(signatureBody());
    expect(first.status).toBe(201);
    expect(first.headers['x-idempotent-replay']).toBeUndefined();
    const signatureId = first.body.signatureId as string;

    // Uçak modu kurtarma: aynı anahtarla yeniden gönderim.
    const replay = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .set('x-idempotency-key', key)
      .send(signatureBody());
    expect(replay.status).toBe(201);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(replay.body.signatureId).toBe(signatureId);

    const list = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders/${workOrderId}/signatures`)
      .expect(200);
    expect(list.body.data).toHaveLength(1); // çift kayıt YOK
  });

  it('düzeltme: yeni satır + correctionOfId; eski superseded olur; ikinci düzeltme 409', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });

    const original = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .send(signatureBody({ signerName: 'Yanlış İsim' }))
      .expect(201);

    const correction = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .send(
        signatureBody({
          signerName: 'Ayşe Yılmaz',
          correctionOfId: original.body.signatureId,
        }),
      )
      .expect(201);
    expect(correction.body.correctionOfId).toBe(original.body.signatureId);

    const list = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders/${workOrderId}/signatures`)
      .expect(200);
    expect(list.body.data).toHaveLength(2); // geçmiş kalır (append-only)
    const oldRow = list.body.data.find(
      (s: { signatureId: string }) => s.signatureId === original.body.signatureId,
    );
    expect(oldRow.supersededById).toBe(correction.body.signatureId);

    // Zaten düzeltilmiş imzayı tekrar düzeltme girişimi → 409.
    const second = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .send(signatureBody({ correctionOfId: original.body.signatureId }));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('SIGNATURE_ALREADY_CORRECTED');
  });

  it('imza yetkisi olmayan kullanıcı (depo) imza yakalayamaz — 403', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });
    const response = await authed(warehouseUser.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .send(signatureBody());
    expect(response.status).toBe(403);
  });
});

describe('Medya — iki adımlı yükleme (ADR-0005)', () => {
  async function arrivedWorkOrder() {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });
    return workOrderId;
  }

  it('beyaz liste dışı MIME ve üst limit reddi (400)', async () => {
    const workOrderId = await arrivedWorkOrder();
    const svg = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media`)
      .send({ kind: 'PHOTO', fileName: 'x.svg', contentType: 'image/svg+xml', sizeBytes: 100 });
    expect(svg.status).toBe(400);
    expect(svg.body.code).toBe('MEDIA_MIME_NOT_ALLOWED');

    const oversized = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media`)
      .send({
        kind: 'PHOTO',
        fileName: 'dev.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 20 * 1024 * 1024,
      });
    expect(oversized.status).toBe(400);
    expect(oversized.body.code).toBe('MEDIA_SIZE_LIMIT');

    const traversal = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media`)
      .send({
        kind: 'DOCUMENT',
        fileName: '../../etc/passwd',
        contentType: 'application/pdf',
        sizeBytes: 10,
      });
    expect(traversal.status).toBe(400);
  });

  it("init → PUT (gerçek JPEG) → complete: READY + imzalı indirme URL'si çalışır", async () => {
    const workOrderId = await arrivedWorkOrder();

    const init = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media`)
      .send({
        kind: 'PHOTO',
        fileName: 'kompresor-arizasi.jpg',
        contentType: 'image/jpeg',
        sizeBytes: JPEG_BYTES.length,
      })
      .expect(201);
    expect(init.body.uploadMethod).toBe('PUT');
    expect(init.body.uploadUrl).toContain('X-Amz-Signature');

    // İkili yükleme — doğrudan obje deposuna (API'den geçmez).
    const put = await fetch(init.body.uploadUrl as string, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: JPEG_BYTES,
    });
    expect(put.status).toBeLessThan(300);

    const complete = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media/${init.body.mediaId}/complete`)
      .send({})
      .expect(201);
    expect(complete.body.status).toBe('READY');
    expect(complete.body.sizeBytes).toBe(JPEG_BYTES.length);
    expect(complete.body.downloadUrl).toBeTruthy();

    // İmzalı indirme URL'si gerçek baytları döndürür.
    const download = await fetch(complete.body.downloadUrl as string);
    expect(download.status).toBe(200);
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.subarray(0, 3)).toEqual(JPEG_BYTES.subarray(0, 3));

    // Çift complete → idempotent (aynı durum, hata yok).
    const completeAgain = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media/${init.body.mediaId}/complete`)
      .send({});
    expect(completeAgain.status).toBe(201);
    expect(completeAgain.body.status).toBe('READY');
  });

  it('medya yeniden deneme: PUT yoksa 409 UPLOAD_NOT_RECEIVED; sahte içerik FAILED', async () => {
    const workOrderId = await arrivedWorkOrder();

    // PUT yapılmadan complete → nesne yok.
    const ghost = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media`)
      .send({ kind: 'PHOTO', fileName: 'yok.jpg', contentType: 'image/jpeg', sizeBytes: 14 })
      .expect(201);
    const missing = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media/${ghost.body.mediaId}/complete`)
      .send({});
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe('UPLOAD_NOT_RECEIVED');

    // SVG/metin yüklenir ama declared=image/jpeg → MAGIC_BYTE_MISMATCH.
    const init = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media`)
      .send({
        kind: 'PHOTO',
        fileName: 'kötü.jpg',
        contentType: 'image/jpeg',
        sizeBytes: TEXT_BYTES.length,
      })
      .expect(201);
    const put = await fetch(init.body.uploadUrl as string, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: TEXT_BYTES,
    });
    expect(put.status).toBeLessThan(300);

    const failed = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media/${init.body.mediaId}/complete`)
      .send({});
    expect(failed.status).toBe(201);
    expect(failed.body.status).toBe('FAILED');
    expect(failed.body.failureCode).toBe('MAGIC_BYTE_MISMATCH');
  });
});

describe('Yürütme raporu ve kiracı izolasyonu', () => {
  it('rapor tüm kanıt artefaktlarını taşır', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });
    await transition(tech1.cookies, workOrderId, { to: 'IN_PROGRESS' });
    const item = await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/checklist-items`)
      .send({ label: 'Final test' })
      .expect(201);
    await authed(tech1.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}/checklist-items/${item.body.itemId}`)
      .send({ done: true })
      .expect(200);
    await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/time-entries`)
      .send({
        type: 'TRAVEL',
        startedAt: '2026-11-10T08:00:00.000Z',
        endedAt: '2026-11-10T09:00:00.000Z',
      })
      .expect(201);
    await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .send(signatureBody())
      .expect(201);

    const report = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders/${workOrderId}/report`)
      .expect(200);
    expect(report.body.workOrderId).toBe(workOrderId);
    expect(report.body.visits).toHaveLength(1);
    expect(report.body.checklist).toHaveLength(1);
    expect(report.body.checklist[0].done).toBe(true);
    expect(report.body.timeEntries).toHaveLength(1);
    expect(report.body.signatures).toHaveLength(1);
    expect(report.body.labor.travelMinutes).toBe(60);
    expect(report.body.requiredChecklistRemaining).toBe(0);
  });

  it("kiracı B, kiracı A'nın kanıtlarını GÖREMEZ (404 — varlık sızıntısı yok)", async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });
    await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .send(signatureBody())
      .expect(201);

    for (const path of [
      `/api/v1/work-orders/${workOrderId}/report`,
      `/api/v1/work-orders/${workOrderId}/checklist-items`,
      `/api/v1/work-orders/${workOrderId}/time-entries`,
      `/api/v1/work-orders/${workOrderId}/media`,
      `/api/v1/work-orders/${workOrderId}/signatures`,
    ]) {
      const response = await authed(tenantB.cookies).get(path);
      expect(response.status, path).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    }

    // Yazma denemesi de 404 (varlık varlığı sızdırılmaz).
    const write = await authed(tenantB.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .send(signatureBody());
    expect(write.status).toBe(404);
  });

  it('terminal iş emri (CLOSED) kanıt eklemeyi reddeder — 409 WORK_ORDER_IMMUTABLE', async () => {
    const workOrderId = await createAssignedInProgressWorkOrder(tenantA);
    await transition(tech1.cookies, workOrderId, { to: 'ON_SITE', location: GPS_LOCATION });
    await transition(tech1.cookies, workOrderId, { to: 'IN_PROGRESS' });
    await transition(tech1.cookies, workOrderId, { to: 'COMPLETED' });
    await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .send(signatureBody())
      .expect(201);
    const closed = await transition(tenantA.cookies, workOrderId, { to: 'CLOSED' });
    expect(closed.status).toBe(201);

    const item = await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/checklist-items`)
      .send({ label: 'Geç madde' });
    expect(item.status).toBe(409);
    expect(item.body.code).toBe('WORK_ORDER_IMMUTABLE');

    const signature = await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/signatures`)
      .send(signatureBody());
    expect(signature.status).toBe(409);

    const media = await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/media`)
      .send({ kind: 'PHOTO', fileName: 'geç.jpg', contentType: 'image/jpeg', sizeBytes: 14 });
    expect(media.status).toBe(409);
  });
});
