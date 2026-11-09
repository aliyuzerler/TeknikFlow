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
 * TEST-06 — DISPATCH entegrasyon testleri (gerçek DB/RLS).
 *
 * Kabul kriterleri: çift rezervasyon izinsiz/asılsız ENGELLENİR (409
 * SCHEDULE_CONFLICT; override yalnız work_orders:dispatch_override izni +
 * ≥10 karakter nedenle); saat dilimi doğruluğu (İstanbul duvar saati
 * pencereleri); pano/planlama uçtan uca; kiracı izolasyonu (404/RLS).
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
  cookies: { session: string; csrf: string };
  customerId?: string;
}

let tenantA: TenantCtx;
let tenantB: TenantCtx;
let tech1: { userId: string; cookies: { session: string; csrf: string } };
let tech2: { userId: string; cookies: { session: string; csrf: string } };
let dispatcher: { userId: string; cookies: { session: string; csrf: string } };

function authed(cookies: { session: string; csrf: string }) {
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

/** Gelecek Pazartesi 06:00 UTC (İstanbul yerel 09:00 — çalışma saati içi). */
function nextMondayHour(hourUtc: number, minuteUtc = 0): string {
  const date = new Date();
  const add = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + add);
  date.setUTCHours(hourUtc, minuteUtc, 0, 0);
  return date.toISOString();
}

/** Pazartesi Istanbul yerel tarihi (pano date parametresi için). */
function nextMondayLocalDate(): string {
  const date = new Date();
  const add = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + add);
  return date.toISOString().slice(0, 10);
}

/** Gelecek Salı N saat UTC (ikinci planlama günü — slot ayrımı). */
function nextTuesdayHour(hourUtc: number, minuteUtc = 0): string {
  const date = new Date(nextMondayHour(0));
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(hourUtc, minuteUtc, 0, 0);
  return date.toISOString();
}

let mondayLocalDate: string;
let slaQueueWorkOrderNo: string;

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

  const a = await signup('DispatchA');
  const b = await signup('DispatchB');
  tenantA = {
    tenantId: a.response.body.membership.tenantId,
    cookies: a.cookies,
  };
  tenantB = {
    tenantId: b.response.body.membership.tenantId,
    cookies: b.cookies,
  };

  for (const tenant of [tenantA, tenantB]) {
    const customer = await authed(tenant.cookies)
      .post('/api/v1/customers')
      .send({ name: `Dispatch Müşteri ${RUN} ${tenant.tenantId.slice(0, 4)}` })
      .expect(201);
    tenant.customerId = customer.body.customerId as string;
  }

  tech1 = await addMember(tenantA, 'tech1', 'technician');
  tech2 = await addMember(tenantA, 'tech2', 'technician');
  dispatcher = await addMember(tenantA, 'planlayici', 'dispatcher');

  mondayLocalDate = nextMondayLocalDate();

  // Teknisyen çalışma saatleri: Pzt-Cum 09:00-18:00 yerel (İstanbul).
  await authed(tenantA.cookies)
    .put(`/api/v1/dispatch/technicians/${tech1.userId}/working-hours`)
    .send({
      hours: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        startMinute: 540,
        endMinute: 1080,
      })),
    })
    .expect(200);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('dispatch temel akış — profil, pano, planlama', () => {
  it('çalışma saatleri kaydedilir ve teknisyen listesinde görünür', async () => {
    const list = await authed(tenantA.cookies).get('/api/v1/dispatch/technicians').expect(200);
    const tech = list.body.data.find((row: { userId: string }) => row.userId === tech1.userId);
    expect(tech).toBeTruthy();
    expect(tech!.territory ?? null).toBeNull();
    expect(tech.dailyCapacityMinutes).toBe(480);
  });

  it('profil upsert (bölge + kapasite) ve yetenek atama', async () => {
    await authed(tenantA.cookies)
      .put(`/api/v1/dispatch/technicians/${tech1.userId}/profile`)
      .send({ territory: 'Kocaeli koridoru', dailyCapacityMinutes: 450 })
      .expect(200);

    const skill = await authed(tenantA.cookies)
      .post('/api/v1/dispatch/skills')
      .send({ key: `hvac-${RUN}`, name: 'İklimlendirme' })
      .expect(201);
    await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/technicians/${tech1.userId}/skills`)
      .send({ skillId: skill.body.skillId, level: 4 })
      .expect(201);

    const list = await authed(tenantA.cookies).get('/api/v1/dispatch/technicians');
    const tech = list.body.data.find((row: { userId: string }) => row.userId === tech1.userId);
    expect(tech!.territory).toBe('Kocaeli koridoru');
    expect(tech!.dailyCapacityMinutes).toBe(450);
    expect(tech!.skills).toHaveLength(1);
    expect(tech!.skills[0].level).toBe(4);
    expect(tech!.skills[0].key).toBe(`hvac-${RUN}`);
  });

  it('DRAFT iş emri tek adımda planlanır ve atanır (ASSIGNED)', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Planlama ${RUN}` });
    const response = await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextMondayHour(6),
        scheduledEnd: nextMondayHour(10),
      })
      .expect(201);
    expect(response.body.workOrder.status).toBe('ASSIGNED');
    expect(response.body.workOrder.assignedToId).toBe(tech1.userId);
    expect(response.body.workOrder.scheduledStart).toBe(nextMondayHour(6));
    expect(response.body.skillWarnings).toEqual([]);

    // Atama geçmişi ACTIVE kayıt üretir.
    const detail = await authed(tenantA.cookies).get(`/api/v1/work-orders/${workOrderId}`);
    expect(detail.body.assignments).toHaveLength(1);
    expect(detail.body.assignments[0].status).toBe('ACTIVE');
  });

  it('SLA alanları: oluşturulan iş emrinde slaDueAt dolar; URGENT pano uyarısına düşer', async () => {
    const { workOrderId, workOrderNo } = await createWorkOrder(tenantA, {
      subject: `SLA ${RUN}`,
      priority: 'URGENT',
    });
    slaQueueWorkOrderNo = workOrderNo;
    const detail = await authed(tenantA.cookies).get(`/api/v1/work-orders/${workOrderId}`);
    expect(detail.body.slaDueAt).toBeTruthy();
    expect(detail.body.slaAtRisk).toBe(true);
    expect(detail.body.slaBreached).toBe(false);

    const board = await authed(tenantA.cookies)
      .get(`/api/v1/dispatch/board?date=${mondayLocalDate}`)
      .expect(200);
    const alert = (board.body.slaAlerts as Array<{ workOrderNo: string }>).find(
      (row) => row.workOrderNo === workOrderNo,
    );
    expect(alert).toBeTruthy();
  });

  it('pano: teknisyen kolonunda günün işi + kapasite; kuyrukta planlanmamış iş', async () => {
    const board = await authed(tenantA.cookies)
      .get(`/api/v1/dispatch/board?date=${mondayLocalDate}`)
      .expect(200);
    expect(board.body.date).toBe(mondayLocalDate);
    expect(board.body.timezone).toBe('Europe/Istanbul');
    // İstanbul günü önceki gün 21:00 UTC'de başlar.
    const previousDay = new Date(Date.parse(`${mondayLocalDate}T00:00:00Z`) - 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    expect(board.body.dayStartsAt).toBe(`${previousDay}T21:00:00.000Z`);
    const column = (
      board.body.technicians as Array<{ userId: string; workOrders: unknown[]; capacity: unknown }>
    ).find((row) => row.userId === tech1.userId);
    expect(column).toBeTruthy();
    expect(column!.workOrders.length).toBeGreaterThanOrEqual(1);
    expect((column!.capacity as { capacityMinutes: number }).capacityMinutes).toBe(450);
    // Kuyrukta planlanmamış URGENT iş görünür.
    const queue = board.body.queue as Array<{ workOrderNo: string; slaAtRisk: boolean }>;
    const queued = queue.find((row) => row.workOrderNo === slaQueueWorkOrderNo);
    expect(queued?.slaAtRisk).toBe(true);
  });
});

describe('çift rezervasyon engeli (kabul ölçütü)', () => {
  it('örtüşen ikinci iş → 409 SCHEDULE_CONFLICT + OVERLAP bulgusu', async () => {
    await createWorkOrder(tenantA, { subject: `Çakışan A ${RUN}` }).then(async (first) => {
      await authed(tenantA.cookies)
        .post(`/api/v1/dispatch/schedule/${first.workOrderId}`)
        .send({
          assigneeUserId: tech1.userId,
          scheduledStart: nextMondayHour(10),
          scheduledEnd: nextMondayHour(12),
        })
        .expect(201);
    });

    const second = await createWorkOrder(tenantA, { subject: `Çakışan B ${RUN}` });
    const response = await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${second.workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextMondayHour(9), // 09:00-13:00 UTC → 06:00-10:00 ile örtüşür
        scheduledEnd: nextMondayHour(13),
      })
      .expect(409);
    expect(response.body.code).toBe('SCHEDULE_CONFLICT');
    expect(response.body.conflicts).toBeInstanceOf(Array);
    expect(response.body.conflicts[0].type).toBe('OVERLAP');
    expect(response.body.conflicts[0].workOrderNo).toMatch(/^WO-\d{4}-\d{4}$/);
  });

  it('bitişik (uçtan-uca) iş SERBESTTİR — örtüşme sayılmaz', async () => {
    const adjacent = await createWorkOrder(tenantA, { subject: `Bitişik ${RUN}` });
    await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${adjacent.workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextMondayHour(12), // 10:00-12:00'nin hemen ardından
        scheduledEnd: nextMondayHour(14),
      })
      .expect(201);
  });

  it('çalışma saatleri dışı → 409 OUTSIDE_WORKING_HOURS', async () => {
    const late = await createWorkOrder(tenantA, { subject: `Gece ${RUN}` });
    const response = await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${late.workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextMondayHour(18), // İstanbul yerel 21:00
        scheduledEnd: nextMondayHour(21),
      })
      .expect(409);
    expect(response.body.conflicts[0].type).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('izin çakışması → 409 TIME_OFF; iptal edilince planlanır', async () => {
    const timeOff = await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/technicians/${tech2.userId}/time-off`)
      .send({
        startAt: nextMondayHour(0),
        endAt: nextMondayHour(23, 59),
        reason: 'Yıllık izin (test)',
      })
      .expect(201);

    const duringOff = await createWorkOrder(tenantA, { subject: `İzinli ${RUN}` });
    const blocked = await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${duringOff.workOrderId}`)
      .send({
        assigneeUserId: tech2.userId,
        scheduledStart: nextMondayHour(6),
        scheduledEnd: nextMondayHour(8),
      })
      .expect(409);
    expect(blocked.body.conflicts[0].type).toBe('TIME_OFF');

    await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/time-offs/${timeOff.body.timeOffId}/cancel`)
      .expect(201);

    await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${duringOff.workOrderId}`)
      .send({
        assigneeUserId: tech2.userId,
        scheduledStart: nextMondayHour(6),
        scheduledEnd: nextMondayHour(8),
      })
      .expect(201);
  });

  it('doğrudan ASSIGNED geçişi de çakışmayı engeller (tek gerçeklik: koruyucu)', async () => {
    const direct = await createWorkOrder(tenantA, { subject: `Geçiş ${RUN}` });
    await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${direct.workOrderId}/transition`)
      .send({
        to: 'PLANNED',
        scheduledStart: nextMondayHour(6),
        scheduledEnd: nextMondayHour(10),
      })
      .expect(201);

    const response = await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${direct.workOrderId}/transition`)
      .send({
        to: 'ASSIGNED',
        assigneeUserId: tech1.userId, // tech1 06:00-10:00 dolu
      })
      .expect(409);
    expect(response.body.code).toBe('SCHEDULE_CONFLICT');
    expect(response.body.conflicts[0].type).toBe('OVERLAP');
  });

  it('PATCH schedule çakışması da engeller (ikinci koruyucu)', async () => {
    const { workOrderId } = await createWorkOrder(tenantA, { subject: `Patch ${RUN}` });
    // Önce boş saat dilimine ata (14:00-14:30 UTC — Pazartesi son boş dilim).
    await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextMondayHour(14),
        scheduledEnd: nextMondayHour(14, 30),
      })
      .expect(201);

    // Şimdi dolu dilime kaydır (06:00-10:00 ile örtüşür).
    const response = await authed(tenantA.cookies)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .send({
        scheduledStart: nextMondayHour(7),
        scheduledEnd: nextMondayHour(9),
        expectedVersion: 2,
      })
      .expect(409);
    expect(response.body.code).toBe('SCHEDULE_CONFLICT');
  });
});

describe('override — izin + neden + denetim izi', () => {
  it('planlamacı (dispatcher) override deneyince 403 OVERRIDE_FORBIDDEN', async () => {
    const wo = await createWorkOrder(tenantA, { subject: `Override yetki ${RUN}` });
    await authed(dispatcher.cookies)
      .post(`/api/v1/dispatch/schedule/${wo.workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextMondayHour(7),
        scheduledEnd: nextMondayHour(9),
        overrideConflict: true,
        overrideReason: 'Acil müşteri talebi üzerine planlama',
      })
      .expect(403);
  });

  it('sahip (owner) nedenle override → 200 + kalıcı neden + olay kaydı', async () => {
    const wo = await createWorkOrder(tenantA, { subject: `Override sahipli ${RUN}` });
    const response = await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${wo.workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextMondayHour(7),
        scheduledEnd: nextMondayHour(9),
        overrideConflict: true,
        overrideReason: 'Müşteri acil talebi — teknisyen erken ayrılacak',
      })
      .expect(201);
    expect(response.body.workOrder.scheduleOverrideReason).toBe(
      'Müşteri acil talebi — teknisyen erken ayrılacak',
    );

    const detail = await authed(tenantA.cookies).get(`/api/v1/work-orders/${wo.workOrderId}`);
    const overrideEvent = (
      detail.body.events as Array<{ eventType: string; metadata: Record<string, unknown> }>
    ).find((event) => event.eventType === 'work_order.dispatch_override');
    expect(overrideEvent).toBeTruthy();
    expect(overrideEvent!.metadata.reason).toContain('acil talebi');
    expect(overrideEvent!.metadata.conflicts).toContain('OVERLAP');
  });

  it('şema: override bayrağı kısa nedenle reddedilir (400)', async () => {
    const wo = await createWorkOrder(tenantA, { subject: `Kısa neden ${RUN}` });
    await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${wo.workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextMondayHour(7),
        scheduledEnd: nextMondayHour(9),
        overrideConflict: true,
        overrideReason: 'kısa',
      })
      .expect(400);
  });

  it('PATCH koruyucusu da override alanlarını kabul eder (owner)', async () => {
    const wo = await createWorkOrder(tenantA, { subject: `Patch override ${RUN}` });
    await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${wo.workOrderId}`)
      .send({
        assigneeUserId: tech2.userId,
        scheduledStart: nextMondayHour(12),
        scheduledEnd: nextMondayHour(14),
      })
      .expect(201);
    // tech2 06:00-08:00 dolu — 07:00-09:00'a kaydırıp override ile geç.
    const response = await authed(tenantA.cookies)
      .patch(`/api/v1/work-orders/${wo.workOrderId}`)
      .send({
        scheduledStart: nextMondayHour(7),
        scheduledEnd: nextMondayHour(9),
        expectedVersion: 2,
        overrideConflict: true,
        overrideReason: 'Planlama çakışması bilinçli kabul edildi',
      })
      .expect(200);
    expect(response.body.scheduleOverrideReason).toBeTruthy();
  });
});

describe('yeniden atama ve müsaitlik', () => {
  it('ASSIGNED iş başka teknisyene tek adımda devredilir (geçmiş korunur)', async () => {
    const wo = await createWorkOrder(tenantA, { subject: `Devir ${RUN}` });
    await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${wo.workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextTuesdayHour(6), // Salı — Pazartesi dolu
        scheduledEnd: nextTuesdayHour(10),
      })
      .expect(201);

    const response = await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${wo.workOrderId}`)
      .send({
        assigneeUserId: tech2.userId,
        scheduledStart: nextTuesdayHour(6),
        scheduledEnd: nextTuesdayHour(10),
      })
      .expect(201);
    expect(response.body.workOrder.assignedToId).toBe(tech2.userId);

    const detail = await authed(tenantA.cookies).get(`/api/v1/work-orders/${wo.workOrderId}`);
    const statuses = (detail.body.assignments as Array<{ userId: string; status: string }>).map(
      (assignment) => `${assignment.userId}:${assignment.status}`,
    );
    expect(statuses).toContain(`${tech1.userId}:REMOVED`);
    expect(statuses).toContain(`${tech2.userId}:ACTIVE`);
  });

  it('müsaitlik: çalışma penceresi − planlı iş − izin = serbest slot', async () => {
    const from = mondayLocalDate;
    const to = mondayLocalDate; // tek gün
    const availability = await authed(tenantA.cookies)
      .get(`/api/v1/dispatch/technicians/${tech1.userId}/availability?from=${from}&to=${to}`)
      .expect(200);
    expect(availability.body.days).toHaveLength(1);
    const day = availability.body.days[0];
    expect(day.weekday).toBe(1); // Pazartesi
    expect(day.workingWindows).toHaveLength(1);
    // Dolu: 06-10, 07-09(override), 10-12, 12-14, 14-14:30 UTC; serbest: 14:30-15:00.
    const freeStarts = day.freeSlots.map((slot: { startAt: string }) => slot.startAt);
    expect(freeStarts).toContain(`${mondayLocalDate}T14:30:00.000Z`);
  });

  it('çakışma listesi günün bulgularını döner', async () => {
    const conflicts = await authed(tenantA.cookies)
      .get(`/api/v1/dispatch/conflicts?from=${mondayLocalDate}`)
      .expect(200);
    expect(conflicts.body.data).toBeInstanceOf(Array);
    // Override'lı çakışma bilinçli olduğundan panoda görünür kalır.
    expect(conflicts.body.data.some((row: { type: string }) => row.type === 'OVERLAP')).toBe(true);
  });
});

describe('yetenek eşleştirme (danışma)', () => {
  it('kategori yeteneği eksik teknisyene atanınca skillWarnings döner; pano kuyruğunda requiredSkillKeys görünür', async () => {
    // 1) Kategori + yetenek + zorunluluk bağı kur.
    const category = await authed(tenantA.cookies)
      .post('/api/v1/service-requests/categories')
      .send({ key: `mekanik-cat-${RUN}`, name: 'Mekanik Kategori' })
      .expect(201);
    const skill = await authed(tenantA.cookies)
      .post('/api/v1/dispatch/skills')
      .send({ key: `mekanik-${RUN}`, name: 'Mekanik' })
      .expect(201);
    await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/category-skills/${category.body.categoryId}`)
      .send({ skillId: skill.body.skillId })
      .expect(201);

    // 2) Kategorili talep → iş emri dönüşümü (bağ taşır).
    const serviceRequest = await authed(tenantA.cookies)
      .post('/api/v1/service-requests')
      .send({
        customerId: tenantA.customerId,
        categoryId: category.body.categoryId,
        subject: `Kategorili talep ${RUN}`,
      })
      .expect(201);
    const converted = await authed(tenantA.cookies)
      .post(`/api/v1/service-requests/${serviceRequest.body.requestId}/convert`)
      .send({ type: 'CORRECTIVE', priority: 'MEDIUM' })
      .expect(201);
    const workOrderId = converted.body.workOrder.workOrderId as string;

    // 3) Pano kuyruğunda zorunlu yetenek anahtarı görünür.
    const board = await authed(tenantA.cookies)
      .get(`/api/v1/dispatch/board?date=${mondayLocalDate}`)
      .expect(200);
    const queueItem = (
      board.body.queue as Array<{ workOrderId: string; requiredSkillKeys: string[] }>
    ).find((row) => row.workOrderId === workOrderId);
    expect(queueItem?.requiredSkillKeys).toEqual([`mekanik-${RUN}`]);

    // 4) Yeteneği OLMAYAN tech2'ye ata → skillWarnings dolu; tech1'e değil.
    const toTech2 = await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${workOrderId}`)
      .send({
        assigneeUserId: tech2.userId,
        scheduledStart: nextMondayHour(10),
        scheduledEnd: nextMondayHour(11),
      })
      .expect(201);
    expect(toTech2.body.skillWarnings).toEqual([`mekanik-${RUN}`]);

    // 5) Yeteneği olan tech1'e yeniden ata → uyarı yok (yetenek tanımlı).
    await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/technicians/${tech1.userId}/skills`)
      .send({ skillId: skill.body.skillId, level: 5 })
      .expect(201);
    const toTech1 = await authed(tenantA.cookies)
      .post(`/api/v1/dispatch/schedule/${workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextTuesdayHour(10, 30),
        scheduledEnd: nextTuesdayHour(11),
      })
      .expect(201);
    expect(toTech1.body.skillWarnings).toEqual([]);

    // Temizlik: ikinci kez yetenek silme → 404 (kaynak yok).
    await authed(tenantA.cookies)
      .delete(`/api/v1/dispatch/technicians/${tech1.userId}/skills/${skill.body.skillId}`)
      .expect(200);
    await authed(tenantA.cookies)
      .delete(`/api/v1/dispatch/technicians/${tech1.userId}/skills/${skill.body.skillId}`)
      .expect(404);
  });
});

describe('takımlar', () => {
  it('CRUD + üye ekleme/çıkarma; planlamacı takım KURAMAZ', async () => {
    const team = await authed(tenantA.cookies)
      .post('/api/v1/teams')
      .send({ name: `Saha Ekibi ${RUN}`, code: `T${RUN.slice(-4).toUpperCase()}` })
      .expect(201);
    expect(team.body.memberCount).toBe(0);

    await authed(tenantA.cookies)
      .post(`/api/v1/teams/${team.body.teamId}/members`)
      .send({ userId: tech1.userId })
      .expect(201);

    const list = await authed(tenantA.cookies).get('/api/v1/teams').expect(200);
    const found = (list.body.data as Array<{ teamId: string; memberCount: number }>).find(
      (row) => row.teamId === team.body.teamId,
    );
    expect(found?.memberCount).toBe(1);

    // Aynı kullanıcı ikinci takıma eklenemez (MVP: tek takım).
    const team2 = await authed(tenantA.cookies)
      .post('/api/v1/teams')
      .send({ name: `İkinci ${RUN}`, code: `U${RUN.slice(-4).toUpperCase()}` })
      .expect(201);
    await authed(tenantA.cookies)
      .post(`/api/v1/teams/${team2.body.teamId}/members`)
      .send({ userId: tech1.userId })
      .expect(409);

    // Planlamacı (users:manage yok) takım oluşturamaz.
    await authed(dispatcher.cookies)
      .post('/api/v1/teams')
      .send({ name: 'İzinsiz', code: 'IZIN' })
      .expect(403);

    await authed(tenantA.cookies)
      .delete(`/api/v1/teams/${team.body.teamId}/members/${tech1.userId}`)
      .expect(200);

    await authed(tenantA.cookies).delete(`/api/v1/teams/${team.body.teamId}`).expect(200);
    await authed(tenantA.cookies).delete(`/api/v1/teams/${team2.body.teamId}`).expect(200);
  });
});

describe('yetki sınırları', () => {
  it('teknisyen panoyu ve teknisyen listesini GÖREMEZ (403)', async () => {
    await authed(tech1.cookies).get('/api/v1/dispatch/board').expect(403);
    await authed(tech1.cookies).get('/api/v1/dispatch/technicians').expect(403);
    await authed(tech1.cookies)
      .get(
        `/api/v1/dispatch/technicians/${tech1.userId}/availability?from=${mondayLocalDate}&to=${mondayLocalDate}`,
      )
      .expect(403);
  });

  it('teknisyen planlayamaz (403); planlamacı panoyu görür', async () => {
    const wo = await createWorkOrder(tenantA, { subject: `Yetki ${RUN}` });
    await authed(tech1.cookies)
      .post(`/api/v1/dispatch/schedule/${wo.workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextMondayHour(14, 30),
        scheduledEnd: nextMondayHour(15, 30),
      })
      .expect(403);
    await authed(dispatcher.cookies)
      .get(`/api/v1/dispatch/board?date=${mondayLocalDate}`)
      .expect(200);
  });
});

describe('kiracı izolasyonu', () => {
  it("B kiracısı A'nın işini planlayamaz (404 — varlık sızıntısı yok)", async () => {
    const wo = await createWorkOrder(tenantA, { subject: `İzolasyon ${RUN}` });
    await authed(tenantB.cookies)
      .post(`/api/v1/dispatch/schedule/${wo.workOrderId}`)
      .send({
        assigneeUserId: tech1.userId,
        scheduledStart: nextMondayHour(14, 30),
        scheduledEnd: nextMondayHour(15, 30),
      })
      .expect(404);
  });

  it("B, A'nın teknisyenine profil/çalışma saati/izin yazamaz (404)", async () => {
    await authed(tenantB.cookies)
      .put(`/api/v1/dispatch/technicians/${tech1.userId}/profile`)
      .send({ territory: 'başkasının bölgesi' })
      .expect(404);
    await authed(tenantB.cookies)
      .put(`/api/v1/dispatch/technicians/${tech1.userId}/working-hours`)
      .send({ hours: [{ weekday: 1, startMinute: 0, endMinute: 60 }] })
      .expect(404);
    await authed(tenantB.cookies)
      .post(`/api/v1/dispatch/technicians/${tech1.userId}/time-off`)
      .send({
        startAt: nextMondayHour(0),
        endAt: nextMondayHour(1),
      })
      .expect(404);
  });

  it("B panosunda A'nın verisi görünmez; RLS ham kanıt: satır sayısı 0", async () => {
    const boardB = await authed(tenantB.cookies)
      .get(`/api/v1/dispatch/board?date=${mondayLocalDate}`)
      .expect(200);
    const bUserIds = new Set(
      (boardB.body.technicians as Array<{ userId: string }>).map((row) => row.userId),
    );
    expect(bUserIds.has(tech1.userId)).toBe(false);
    expect(boardB.body.queue).toEqual([]);

    const count = await scoped.withTenant(tenantB.tenantId, (tx) =>
      tx.workOrder.count({ where: { tenantId: tenantA.tenantId } }),
    );
    expect(count).toBe(0);
    const profileCount = await scoped.withTenant(tenantB.tenantId, (tx) =>
      tx.technicianProfile.count({ where: { tenantId: tenantA.tenantId } }),
    );
    expect(profileCount).toBe(0);
    const timeOffCount = await scoped.withTenant(tenantB.tenantId, (tx) =>
      tx.timeOff.count({ where: { tenantId: tenantA.tenantId } }),
    );
    expect(timeOffCount).toBe(0);
    const teamCount = await scoped.withTenant(tenantB.tenantId, (tx) =>
      tx.team.count({ where: { tenantId: tenantA.tenantId } }),
    );
    expect(teamCount).toBe(0);
  });

  it("B, A'nın takımına üye ekleyemez (404)", async () => {
    const team = await authed(tenantA.cookies)
      .post('/api/v1/teams')
      .send({ name: `İzole ${RUN}`, code: `Z${RUN.slice(-4).toUpperCase()}` })
      .expect(201);
    const memberB = await addMember(tenantB, 'btech', 'technician');
    await authed(tenantB.cookies)
      .post(`/api/v1/teams/${team.body.teamId}/members`)
      .send({ userId: memberB.userId })
      .expect(404);
    await authed(tenantA.cookies).delete(`/api/v1/teams/${team.body.teamId}`).expect(200);
  });
});
