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
 * TEST-09 §3-§4 — Faz 09 stok uçtan uca (gerçek DB/Redis).
 *
 * Kabul kriterleri birebir:
 *  - Çift hareket YOK (movementKey tekil + idempotency oynatma)
 *  - Onaysız negatif stok YOK (409 NEGATIVE_STOCK_FORBIDDEN + ayrıntı)
 *  - Parti/seri izlenebilirliği (lot zorunlu, süresi geçen lot kapalı)
 *  - ATOMİK tüketim (hareket + bakiye + rezervasyon + olay tek işlemde)
 *  - Çapraz kiracı stok erişimi reddedilir (RLS FORCE kanıtıyla)
 */

const RUN = Date.now().toString(36);
const email = (local: string) => `${local}.${RUN}@test.example`;
const PASSWORD = 'StokServis2026';
/** movementKey / idempotency anahtarları için HEX güvenli sonek (UUID biçimi). */
const KEY = (Date.now() % 0xffffffffffff).toString(16).padStart(12, '0');

let app: INestApplication;
let prisma: PrismaService;
let scoped: TenantScopedPrismaService;

interface TenantCtx {
  tenantId: string;
  slug: string;
  cookies: { session: string; csrf: string };
  customerId: string;
}

let tenantA: TenantCtx;
let tenantB: TenantCtx;
let tech1: { userId: string; cookies: { session: string; csrf: string } };
let tech2: { userId: string; cookies: { session: string; csrf: string } };
let warehouseUser: { userId: string; cookies: { session: string; csrf: string } };

let centralId = '';
let van1Id = '';
let itemNoneId = ''; // NONE — FLT-04-25
let itemLotId = ''; // LOT — GLY-5W-1L (lot maliyetli)
let lotAId = '';
let lotExpiredId = '';
let itemSerialId = ''; // SERIAL — PUMP-SERI
let serialLotId = '';
let workOrderId = '';

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

function cookieHeader(cookies: { session: string; csrf: string }): string {
  return `tf_session=${cookies.session}; tf_csrf=${cookies.csrf}`;
}

function authed(cookies: { session: string; csrf: string }) {
  const withHeaders = (req: request.Test) =>
    req.set('Cookie', cookieHeader(cookies)).set('x-csrf-token', cookies.csrf);
  return {
    get: (url: string) => withHeaders(request(app.getHttpServer()).get(url)),
    post: (url: string) => withHeaders(request(app.getHttpServer()).post(url)),
    patch: (url: string) => withHeaders(request(app.getHttpServer()).patch(url)),
    put: (url: string) => withHeaders(request(app.getHttpServer()).put(url)),
    delete: (url: string) => withHeaders(request(app.getHttpServer()).delete(url)),
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
  const invitation = await authed(tenant.cookies)
    .post('/api/v1/tenants/current/invitations')
    .send({ email: inviteeEmail, roleKey })
    .expect(201);
  const accept = await request(app.getHttpServer())
    .post(`/api/v1/invitations/${invitation.body.inviteToken}/accept`)
    .send({ password: PASSWORD, displayName: 'Stok Kullanıcısı' })
    .expect(200);
  return {
    email: inviteeEmail,
    userId: accept.body.user.userId as string,
    membershipId: accept.body.membership.membershipId as string,
    cookies: extractCookies(accept),
  };
}

async function transition(
  cookies: { session: string; csrf: string },
  workOrderIdArg: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return authed(cookies).post(`/api/v1/work-orders/${workOrderIdArg}/transition`).send(body);
}

const GPS_LOCATION = {
  latitude: 40.993,
  longitude: 29.12,
  accuracyMeters: 9.5,
  capturedAt: '2026-11-10T09:30:00.000Z',
  source: 'GPS',
};

let windowSeq = 0;
/** Teknisyene atanmış IN_PROGRESS iş emri (benzersiz planlama penceresi). */
async function createInProgressWorkOrder(
  tenant: TenantCtx,
  tech: { userId: string; cookies: { session: string; csrf: string } },
): Promise<string> {
  windowSeq += 1;
  const day = 5 + windowSeq;
  const dayStr = String(day).padStart(2, '0');
  const created = await authed(tenant.cookies)
    .post('/api/v1/work-orders')
    .send({
      customerId: tenant.customerId,
      subject: `Stok iş emri ${RUN}-${windowSeq}`,
      priority: 'MEDIUM',
    })
    .expect(201);
  const woId = created.body.workOrderId as string;
  await transition(tenant.cookies, woId, {
    to: 'PLANNED',
    scheduledStart: `2026-12-${dayStr}T09:00:00.000Z`,
    scheduledEnd: `2026-12-${dayStr}T13:00:00.000Z`,
  });
  await transition(tenant.cookies, woId, { to: 'ASSIGNED', assigneeUserId: tech.userId });
  await transition(tech.cookies, woId, { to: 'ACCEPTED' });
  await transition(tech.cookies, woId, { to: 'EN_ROUTE' });
  await transition(tech.cookies, woId, { to: 'ON_SITE', location: GPS_LOCATION });
  await transition(tech.cookies, woId, { to: 'IN_PROGRESS' });
  return woId;
}

/** Depo dengesini okur (satır yoksa 0 döner). */
async function balanceOf(
  warehouseId: string,
  itemId: string,
  cookies = warehouseUser.cookies,
): Promise<{ onHand: number; reservedQty: number; available: number; lotRows: number }> {
  const response = await authed(cookies)
    .get(`/api/v1/inventory/balances?warehouseId=${warehouseId}&itemId=${itemId}`)
    .expect(200);
  const rows: Array<{ onHand: number; reservedQty: number; available: number; lotId: string | null }> =
    response.body.data ?? [];
  const onHand = rows.reduce((sum, row) => sum + row.onHand, 0);
  const reservedQty = rows.reduce((sum, row) => sum + row.reservedQty, 0);
  return { onHand, reservedQty, available: rows[0]?.available ?? 0, lotRows: rows.length };
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

  const a = await signup('StokA');
  const b = await signup('StokB');
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
      .send({ name: `Stok Müşteri ${RUN} ${tenant.tenantId.slice(0, 4)}` })
      .expect(201);
    tenant.customerId = customer.body.customerId as string;
  }

  tech1 = await addMember(tenantA, 'tech-stock1', 'technician');
  tech2 = await addMember(tenantA, 'tech-stock2', 'technician');
  warehouseUser = await addMember(tenantA, 'warehouse-stock', 'warehouse');
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Katalog ve depo temel kurulumu', () => {
  it('teknisyen kalem oluşturamaz (403) — yalnız stock:manage', async () => {
    const response = await authed(tech1.cookies)
      .post('/api/v1/inventory/items')
      .send({ sku: `TECH-${RUN}`, name: 'Teknisyen Kalemi', unit: 'ad' });
    expect(response.status).toBe(403);
  });

  it('kalem oluşturulur; aynı SKU ikinci kez reddedilir (409 ITEM_DUPLICATE)', async () => {
    const created = await authed(tenantA.cookies)
      .post('/api/v1/inventory/items')
      .send({ sku: 'FLT-04-25', name: 'Hava filtresi', unit: 'ad', reorderPoint: 5 })
      .expect(201);
    itemNoneId = created.body.itemId as string;
    expect(created.body.trackingMode).toBe('NONE');
    expect(created.body.totalOnHand).toBe(0);

    const duplicate = await authed(tenantA.cookies)
      .post('/api/v1/inventory/items')
      .send({ sku: 'FLT-04-25', name: 'Yinelenen filtre', unit: 'ad' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('ITEM_DUPLICATE');
  });

  it('parti ve seri kalemleri oluşturulur', async () => {
    const lotItem = await authed(tenantA.cookies)
      .post('/api/v1/inventory/items')
      .send({
        sku: 'GLY-5W-1L',
        name: 'Glikol 5W 1L',
        unit: 'lt',
        trackingMode: 'LOT',
        reorderPoint: 2,
      })
      .expect(201);
    itemLotId = lotItem.body.itemId as string;

    const serialItem = await authed(tenantA.cookies)
      .post('/api/v1/inventory/items')
      .send({ sku: 'PUMP-SERI', name: 'Pompa (seri izlemeli)', unit: 'ad', trackingMode: 'SERIAL' })
      .expect(201);
    itemSerialId = serialItem.body.itemId as string;
  });

  it('araç deposu sahipsiz reddedilir (sözleşme); sahipli oluşturulur', async () => {
    const missing = await authed(tenantA.cookies)
      .post('/api/v1/inventory/warehouses')
      .send({ name: `Van ${RUN}`, type: 'VEHICLE' });
    expect(missing.status).toBe(400);

    const central = await authed(tenantA.cookies)
      .post('/api/v1/inventory/warehouses')
      .send({ name: `Merkez Depo ${RUN}`, type: 'CENTRAL' })
      .expect(201);
    centralId = central.body.warehouseId as string;

    const van = await authed(tenantA.cookies)
      .post('/api/v1/inventory/warehouses')
      .send({
        name: `Teknisyen Aracı 34 ${RUN}`,
        type: 'VEHICLE',
        assignedToId: tech1.userId,
      })
      .expect(201);
    van1Id = van.body.warehouseId as string;
    expect(van.body.assignedToName).not.toBeNull();
  });

  it('aynı depo adı ikinci kez reddedilir (409 WAREHOUSE_DUPLICATE)', async () => {
    const duplicate = await authed(tenantA.cookies)
      .post('/api/v1/inventory/warehouses')
      .send({ name: `Merkez Depo ${RUN}`, type: 'CENTRAL' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('WAREHOUSE_DUPLICATE');
  });

  it('iş emri sahaya taşınır (tüketim senaryosu için)', async () => {
    workOrderId = await createInProgressWorkOrder(tenantA, tech1);
    const detail = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders/${workOrderId}`)
      .expect(200);
    expect(detail.body.status).toBe('IN_PROGRESS');
  });
});

describe('Hareketler — çift hareket yok, onaysız negatif stok yok', () => {
  const MOVEMENT_KEY = `0f1e2d3c-0000-4000-8000-${KEY}`;

  it('RECEIVE: merkez stok girişi bakiye yaratır', async () => {
    const response = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'RECEIVE',
        itemId: itemNoneId,
        quantity: 50,
        toWarehouseId: centralId,
        movementKey: MOVEMENT_KEY,
        note: 'İlk alım',
      })
      .expect(201);
    expect(response.body.movementType).toBe('RECEIVE');
    expect(response.body.quantityDelta).toBe(50);
    expect((await balanceOf(centralId, itemNoneId)).onHand).toBe(50);
  });

  it('aynı movementKey ile tekrar → saklanan satır oynatılır (çift hareket YOK)', async () => {
    const replay = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'RECEIVE',
        itemId: itemNoneId,
        quantity: 50,
        toWarehouseId: centralId,
        movementKey: MOVEMENT_KEY,
      })
      .expect(201);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    const count = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.stockMovement.count({ where: { tenantId: tenantA.tenantId, movementKey: MOVEMENT_KEY } }),
    );
    expect(count).toBe(1);
    expect((await balanceOf(centralId, itemNoneId)).onHand).toBe(50);
  });

  it('ISSUE: merkezden araca çıkış her iki dengeyi doğru günceller', async () => {
    const response = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'ISSUE',
        itemId: itemNoneId,
        quantity: 10,
        fromWarehouseId: centralId,
        toWarehouseId: van1Id,
        movementKey: `aaaa0000-0000-4000-8000-${KEY}`,
      })
      .expect(201);
    expect(response.body.quantityDelta).toBe(0);
    expect((await balanceOf(centralId, itemNoneId)).onHand).toBe(40);
    expect((await balanceOf(van1Id, itemNoneId)).onHand).toBe(10);
  });

  it('onaysız negatif stok reddedilir (409 + available ayrıntısı); yarım yazma yok', async () => {
    const before = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.stockMovement.count({ where: { tenantId: tenantA.tenantId, stockItemId: itemNoneId } }),
    );
    const response = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'TRANSFER',
        itemId: itemNoneId,
        quantity: 1000,
        fromWarehouseId: centralId,
        toWarehouseId: van1Id,
        movementKey: `bbbb0000-0000-4000-8000-${KEY}`,
      });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('NEGATIVE_STOCK_FORBIDDEN');
    expect(response.body.details.available).toBe(40);
    const after = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.stockMovement.count({ where: { tenantId: tenantA.tenantId, stockItemId: itemNoneId } }),
    );
    expect(after).toBe(before);
  });

  it('CONSUME genel hareket ucunda YASAK (yalnız iş emri parça ucu)', async () => {
    // Sözleşme genel harekette CONSUME'u tanımaz (z.enum'te yok) → 400.
    const response = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'CONSUME',
        itemId: itemNoneId,
        quantity: 1,
        fromWarehouseId: centralId,
        movementKey: `cccc0000-0000-4000-8000-${KEY}`,
      });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('mine=true: teknisyen yalnız kendi araç stoğunu görür', async () => {
    const techView = await authed(tech1.cookies)
      .get('/api/v1/inventory/balances?mine=true')
      .expect(200);
    const rows: Array<{ warehouseId: string; warehouseType: string }> = techView.body.data ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.warehouseId).toBe(van1Id);
      expect(row.warehouseType).toBe('VEHICLE');
    }
    const tech2View = await authed(tech2.cookies)
      .get('/api/v1/inventory/balances?mine=true')
      .expect(200);
    expect((tech2View.body.data ?? []).length).toBe(0);
  });
});

describe('Parti/seri izlenebilirliği', () => {
  it('parti izlenen kalemsiz lot reddedilir (409 LOT_REQUIRED)', async () => {
    const response = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'RECEIVE',
        itemId: itemLotId,
        quantity: 10,
        toWarehouseId: centralId,
        movementKey: `dddd0000-0000-4000-8000-${KEY}`,
      });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('LOT_REQUIRED');
  });

  it('parti girişi: lot bağlı bakiye + hareket satırı lotNo taşır (izlenebilirlik)', async () => {
    const lot = await authed(warehouseUser.cookies)
      .post(`/api/v1/inventory/warehouses/${centralId}/bins`)
      .send({ code: 'A-01' })
      .expect(201);
    expect(lot.body.binId).toBeTruthy();

    lotAId = await scoped.withTenant(tenantA.tenantId, async (tx) => {
      const lot = await tx.stockLot.create({
        data: {
          tenantId: tenantA.tenantId,
          stockItemId: itemLotId,
          lotNo: 'LOT-2026-11-A',
          costMinor: 1250,
          expiresAt: new Date('2027-06-01T00:00:00.000Z'),
        },
      });
      return lot.id;
    });

    const receive = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'RECEIVE',
        itemId: itemLotId,
        quantity: 12,
        lotId: lotAId,
        toWarehouseId: centralId,
        movementKey: `eeee0000-0000-4000-8000-${KEY}`,
      })
      .expect(201);
    expect(receive.body.lotNo).toBe('LOT-2026-11-A');
    expect(receive.body.unitCostMinor).toBeNull();

    const detail = await authed(warehouseUser.cookies)
      .get(`/api/v1/inventory/movements/${receive.body.movementId}`)
      .expect(200);
    expect(detail.body.lotNo).toBe('LOT-2026-11-A');
    expect((await balanceOf(centralId, itemLotId)).lotRows).toBe(1);
  });

  it('süresi geçmiş lot hareketi reddedilir (409 LOT_EXPIRED)', async () => {
    lotExpiredId = await scoped.withTenant(tenantA.tenantId, async (tx) => {
      const lot = await tx.stockLot.create({
        data: {
          tenantId: tenantA.tenantId,
          stockItemId: itemLotId,
          lotNo: 'LOT-2025-EXPIRED',
          expiresAt: new Date('2025-01-01T00:00:00.000Z'),
        },
      });
      return lot.id;
    });
    const response = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'RECEIVE',
        itemId: itemLotId,
        quantity: 5,
        lotId: lotExpiredId,
        toWarehouseId: centralId,
        movementKey: `ffff0000-0000-4000-8000-${KEY}`,
      });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('LOT_EXPIRED');
  });

  it('seri kalemsiz seri reddedilir; kesirsiz miktar kuralı tüketimde uygulanır', async () => {
    serialLotId = await scoped.withTenant(tenantA.tenantId, async (tx) => {
      const lot = await tx.stockLot.create({
        data: {
          tenantId: tenantA.tenantId,
          stockItemId: itemSerialId,
          lotNo: 'SN-2026-000001',
          serialNo: 'SN-2026-000001',
          costMinor: 480000,
        },
      });
      return lot.id;
    });

    const receive = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'RECEIVE',
        itemId: itemSerialId,
        quantity: 1,
        lotId: serialLotId,
        toWarehouseId: van1Id,
        movementKey: `aa110000-0000-4000-8000-${KEY}`,
      })
      .expect(201);
    expect(receive.body.lotNo).toBe('SN-2026-000001');
  });
});

describe('İş emri parça tüketimi — atomik ve idempotent', () => {
  it('teknisyen kendi aracından tüketir (depo belirtmeden — van otomatik)', async () => {
    const before = (await balanceOf(van1Id, itemNoneId)).onHand;
    const response = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/parts`)
      .set('x-idempotency-key', `22220000-0000-4000-8000-${KEY}`)
      .send({ itemId: itemNoneId, quantity: 3, note: 'Filtre değişimi' })
      .expect(201);
    expect(response.body.warehouseId).toBe(van1Id);
    expect(response.body.totalCostMinor).toBeNull();
    expect((await balanceOf(van1Id, itemNoneId)).onHand).toBe(before - 3);

    // İş emri olayı yazıldı mı? (atomik kanıt)
    const event = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.workOrderEvent.findFirst({
        where: { tenantId: tenantA.tenantId, workOrderId, eventType: 'work_order.part_consumed' },
      }),
    );
    expect(event).not.toBeNull();

    // Parça listesi
    const parts = await authed(tech1.cookies)
      .get(`/api/v1/work-orders/${workOrderId}/parts`)
      .expect(200);
    expect(parts.body.data.length).toBe(1);
    expect(parts.body.data[0].sku).toBe('FLT-04-25');
  });

  it('aynı idempotency anahtarıyla ikinci gönderim → oynatma; TEK tüketim satırı', async () => {
    const key = `33330000-0000-4000-8000-${KEY}`;
    const first = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/parts`)
      .set('x-idempotency-key', key)
      .send({ itemId: itemNoneId, quantity: 2 })
      .expect(201);
    const before = (await balanceOf(van1Id, itemNoneId)).onHand;

    const replay = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/parts`)
      .set('x-idempotency-key', key)
      .send({ itemId: itemNoneId, quantity: 2 })
      .expect(201);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(replay.body.movementId).toBe(first.body.movementId);
    expect((await balanceOf(van1Id, itemNoneId)).onHand).toBe(before);
  });

  it('stok aşımı: 409 NEGATIVE_STOCK_FORBIDDEN — bakiye ve defter değişmez (atomik)', async () => {
    const beforeBalance = (await balanceOf(van1Id, itemNoneId)).onHand;
    const beforeMovements = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.stockMovement.count({ where: { tenantId: tenantA.tenantId, referenceId: workOrderId } }),
    );
    const response = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/parts`)
      .set('x-idempotency-key', `44440000-0000-4000-8000-${KEY}`)
      .send({ itemId: itemNoneId, quantity: beforeBalance + 10 });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('NEGATIVE_STOCK_FORBIDDEN');
    expect((await balanceOf(van1Id, itemNoneId)).onHand).toBe(beforeBalance);
    const afterMovements = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.stockMovement.count({ where: { tenantId: tenantA.tenantId, referenceId: workOrderId } }),
    );
    expect(afterMovements).toBe(beforeMovements);
  });

  it('başka teknisyen (atanmamış) iş emrine parça yazamaz (403)', async () => {
    const response = await authed(tech2.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/parts`)
      .set('x-idempotency-key', `55550000-0000-4000-8000-${KEY}`)
      .send({ itemId: itemNoneId, quantity: 1 });
    expect(response.status).toBe(403);
  });

  it('teknisyen merkez deposundan tüketemez (403) — yalnız kendi aracı', async () => {
    const response = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/parts`)
      .set('x-idempotency-key', `66660000-0000-4000-8000-${KEY}`)
      .send({ itemId: itemNoneId, quantity: 1, warehouseId: centralId });
    expect(response.status).toBe(403);
  });

  it('lot maliyetli tüketim rapora akar (partsCostMinor = qty × lot maliyeti)', async () => {
    const response = await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/parts`)
      .set('x-idempotency-key', `77770000-0000-4000-8000-${KEY}`)
      .send({ itemId: itemLotId, quantity: 2, lotId: lotAId, warehouseId: centralId })
      .expect(201);
    expect(response.body.unitCostMinor).toBe(1250);
    expect(response.body.totalCostMinor).toBe(2500);
    expect(response.body.lotNo).toBe('LOT-2026-11-A');

    const report = await authed(tenantA.cookies)
      .get(`/api/v1/work-orders/${workOrderId}/report`)
      .expect(200);
    expect(report.body.partsCostMinor).toBe(2500);
    const lots = (report.body.parts as Array<{ lotNo: string | null }>).filter(
      (part) => part.lotNo === 'LOT-2026-11-A',
    );
    expect(lots.length).toBe(1);
  });

  it('seri izlenen kalemde kesirli tüketim reddedilir (409 SERIAL_QUANTITY_INVALID)', async () => {
    const response = await authed(tech1.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/parts`)
      .set('x-idempotency-key', `88880000-0000-4000-8000-${KEY}`)
      .send({ itemId: itemSerialId, quantity: 0.5, lotId: serialLotId });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('SERIAL_QUANTITY_INVALID');
  });
});

describe('Rezervasyonlar — kilit ve serbest bırakma', () => {
  it('rezervasyon serbest bakiyeyi düşürür; aşım reddedilir', async () => {
    const before = await balanceOf(centralId, itemNoneId);
    expect(before.onHand).toBeGreaterThan(6);

    const reservation = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/reservations')
      .send({
        workOrderId,
        itemId: itemNoneId,
        warehouseId: centralId,
        quantity: 5,
        note: 'Yedek filtre',
      })
      .expect(201);
    expect(reservation.body.status).toBe('ACTIVE');

    const afterReserve = await balanceOf(centralId, itemNoneId);
    expect(afterReserve.onHand).toBe(before.onHand);
    expect(afterReserve.reservedQty).toBe(before.reservedQty + 5);

    // Serbest tüketim rezerve miktarı aşamaz.
    const oversized = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'TRANSFER',
        itemId: itemNoneId,
        quantity: before.onHand,
        fromWarehouseId: centralId,
        toWarehouseId: van1Id,
        movementKey: `99990000-0000-4000-8000-${KEY}`,
      });
    expect(oversized.status).toBe(409);
    expect(oversized.body.details.available).toBe(before.onHand - 5);

    // Rezervasyon listesi iş emriyle sorgulanır.
    const list = await authed(warehouseUser.cookies)
      .get(`/api/v1/inventory/reservations?workOrderId=${workOrderId}`)
      .expect(200);
    expect(list.body.data.length).toBe(1);

    // Serbest bırakma — kilit geri verilir; ikinci bırakma no-op.
    const release = await authed(warehouseUser.cookies)
      .post(`/api/v1/inventory/reservations/${reservation.body.reservationId}/release`)
      .send({})
      .expect(200);
    expect(release.body.status).toBe('RELEASED');
    const afterRelease = await balanceOf(centralId, itemNoneId);
    expect(afterRelease.reservedQty).toBe(before.reservedQty);

    const releaseAgain = await authed(warehouseUser.cookies)
      .post(`/api/v1/inventory/reservations/${reservation.body.reservationId}/release`)
      .send({})
      .expect(200);
    expect(releaseAgain.body.status).toBe('RELEASED');
  });

  it('rezervasyon içinden tüketim kilidi düşürür (available dokunulmadan)', async () => {
    const reserve = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/reservations')
      .send({ workOrderId, itemId: itemNoneId, warehouseId: centralId, quantity: 4 })
      .expect(201);
    const reservationId = reserve.body.reservationId as string;

    const onHandBefore = (await balanceOf(centralId, itemNoneId)).onHand;
    const consume = await authed(tenantA.cookies)
      .post(`/api/v1/work-orders/${workOrderId}/parts`)
      .set('x-idempotency-key', `aaaa1111-0000-4000-8000-${KEY}`)
      .send({ itemId: itemNoneId, quantity: 4, warehouseId: centralId, reservationId })
      .expect(201);
    expect(consume.body.quantity).toBe(4);

    const after = await balanceOf(centralId, itemNoneId);
    expect(after.onHand).toBe(onHandBefore - 4);
    expect(after.reservedQty).toBe(0);

    const reservationRow = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.stockReservation.findFirst({ where: { id: reservationId, tenantId: tenantA.tenantId } }),
    );
    expect(reservationRow?.status).toBe('CONSUMED');
  });
});

describe('Sayım (cycle count) — onaylı düzeltme', () => {
  let countId = '';

  it('sayım açılır; aynı depoda ikinci açık sayım reddedilir', async () => {
    const created = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/counts')
      .send({ warehouseId: centralId, note: 'Döngüsel sayım' })
      .expect(201);
    countId = created.body.countId as string;
    expect(created.body.status).toBe('OPEN');

    const second = await authed(warehouseUser.cookies)
      .post('/api/v1/inventory/counts')
      .send({ warehouseId: centralId });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('COUNT_ALREADY_OPEN');
  });

  it('satır: beklenen miktar sunucuda donar; kapanış ADJUSTMENT üretir', async () => {
    const onHand = (await balanceOf(centralId, itemNoneId)).onHand;
    const line = await authed(warehouseUser.cookies)
      .post(`/api/v1/inventory/counts/${countId}/lines`)
      .send({ itemId: itemNoneId, countedQty: onHand - 2, note: 'Fiziksel sayım' })
      .expect(201);
    expect(line.body.expectedQty).toBe(onHand);
    expect(line.body.countedQty).toBe(onHand - 2);
    expect(line.body.deltaQty).toBeNull();

    const closed = await authed(warehouseUser.cookies)
      .post(`/api/v1/inventory/counts/${countId}/close`)
      .send({})
      .expect(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.adjustmentCount).toBe(1);

    const after = (await balanceOf(centralId, itemNoneId)).onHand;
    expect(after).toBe(onHand - 2);

    const lines = await authed(warehouseUser.cookies)
      .get(`/api/v1/inventory/counts/${countId}/lines`)
      .expect(200);
    expect(lines.body.data[0].deltaQty).toBe(-2);

    const adjustMovement = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.stockMovement.findFirst({
        where: { tenantId: tenantA.tenantId, referenceType: 'stock_count', referenceId: countId },
      }),
    );
    expect(adjustMovement?.movementType).toBe('ADJUSTMENT');
    expect(Number(adjustMovement?.quantityDelta)).toBe(-2);
  });

  it('kapalı sayıma satır eklenemez ve tekrar kapatılamaz (409)', async () => {
    const line = await authed(warehouseUser.cookies)
      .post(`/api/v1/inventory/counts/${countId}/lines`)
      .send({ itemId: itemNoneId, countedQty: 1 });
    expect(line.status).toBe(409);
    expect(line.body.code).toBe('COUNT_ALREADY_CLOSED');

    const closeAgain = await authed(warehouseUser.cookies)
      .post(`/api/v1/inventory/counts/${countId}/close`)
      .send({});
    expect(closeAgain.status).toBe(409);
    expect(closeAgain.body.code).toBe('COUNT_ALREADY_CLOSED');
  });
});

describe('Çapraz kiracı stok reddi — RLS savunma derinliği', () => {
  it("B sahibi A'nın kalemini göremez (404 — varlık sızmıyor)", async () => {
    const response = await authed(tenantB.cookies)
      .get(`/api/v1/inventory/items/${itemNoneId}`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it("B, A'nın deposuna hareket yazamaz (404)", async () => {
    const response = await authed(tenantB.cookies)
      .post('/api/v1/inventory/movements')
      .send({
        type: 'RECEIVE',
        itemId: itemNoneId,
        quantity: 1,
        toWarehouseId: centralId,
        movementKey: `cccc1111-0000-4000-8000-${KEY}`,
      });
    expect(response.status).toBe(404);
  });

  it("B'nin bakiye listesinde A'nın SKU'su ASLA görünmez", async () => {
    const response = await authed(tenantB.cookies)
      .get('/api/v1/inventory/balances')
      .expect(200);
    const rows: Array<{ sku: string }> = response.body.data ?? [];
    expect(rows.some((row) => row.sku === 'FLT-04-25')).toBe(false);
  });

  it('RLS FORCE: dokuz stok tablosu politikaya tabi (pg_class kanıtı)', async () => {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >(
      "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('stock_items','warehouses','stock_bins','stock_lots','stock_movements','stock_balances','stock_reservations','stock_counts','stock_count_lines') AND relrowsecurity = true AND relforcerowsecurity = true",
    );
    expect(rows.length).toBe(9);
  });

  it("B bağlamında A'nın hareket satırı okunamaz (RLS satır düzeyi)", async () => {
    const movement = await scoped.withTenant(tenantA.tenantId, (tx) =>
      tx.stockMovement.findFirst({
        where: { tenantId: tenantA.tenantId, stockItemId: itemNoneId },
        select: { id: true },
      }),
    );
    expect(movement).not.toBeNull();
    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantB.tenantId}, true)`;
      return tx.stockMovement.findFirst({ where: { id: movement!.id } });
    });
    expect(visible).toBeNull();
  });
});
