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
 * TEST-04 §3-§4 — CRM: CRUD/arama/sayfalama, çift kayıt kuralları, kiracı
 * izolasyonu (IDOR), RLS ham kanıt, rol sınırları, CSV içe aktarma, QR,
 * doküman imzalı URL'leri, varlık geçmişi ve zaman çizelgesi.
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

interface TenantCtx {
  tenantId: string;
  cookies: { session: string; csrf: string };
}

let tenantA: TenantCtx;
let tenantB: TenantCtx;

/** Davetle kiracıya üye ekle (web oturumuyla). */
async function addMember(tenant: TenantCtx, local: string, roleKey: string) {
  const inviteeEmail = email(local);
  const invitation = await request(app.getHttpServer())
    .post('/api/v1/tenants/current/invitations')
    .set('Cookie', cookieHeader(tenant.cookies))
    .set('x-csrf-token', tenant.cookies.csrf)
    .send({ email: inviteeEmail, roleKey })
    .expect(201);
  const accept = await request(app.getHttpServer())
    .post(`/api/v1/invitations/${invitation.body.inviteToken}/accept`)
    .send({ password: PASSWORD, displayName: 'Üye Kullanıcı' })
    .expect(200);
  return { email: inviteeEmail, cookies: extractCookies(accept) };
}

function createCustomer(tenant: TenantCtx, name: string, extra: Record<string, unknown> = {}) {
  return request(app.getHttpServer())
    .post('/api/v1/customers')
    .set('Cookie', cookieHeader(tenant.cookies))
    .set('x-csrf-token', tenant.cookies.csrf)
    .send({ name, ...extra });
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

  const a = await signup('CrmA');
  const b = await signup('CrmB');
  tenantA = { tenantId: a.response.body.membership.tenantId, cookies: a.cookies };
  tenantB = { tenantId: b.response.body.membership.tenantId, cookies: b.cookies };

  // Test gövdesi üye ekler — plan sınırına takılmamak için professional.
  await scoped.withPlatformAdmin(async (tx) => {
    const professional = await tx.plan.findUniqueOrThrow({ where: { code: 'professional' } });
    await tx.subscription.updateMany({
      where: { tenantId: { in: [tenantA.tenantId, tenantB.tenantId] } },
      data: { planId: professional.id },
    });
  });
});

afterAll(async () => {
  await app.close();
});

describe('müşteri CRUD + doğrulama', () => {
  it('oluşturma birincil kontakla birlikte çalışır ve görünüm sayıları taşır', async () => {
    const response = await createCustomer(tenantA, 'Alpha Makine', {
      customerType: 'COMPANY',
      taxId: '1111111101',
      billingAddress: 'Test Cad. 1',
      primaryContact: { name: 'Ali Veli', email: 'ali@alpha.test', phone: '+905550000001' },
    }).expect(201);
    expect(response.body.customerId).toBeTruthy();
    expect(response.body.contactCount).toBe(1);
    expect(response.body.status).toBe('ACTIVE');
  });

  it('200 karakterlik uzun ad kabul; boş/kısa ad 400', async () => {
    await createCustomer(tenantA, 'X'.repeat(200)).expect(201);
    await createCustomer(tenantA, 'A').expect(400);
    await createCustomer(tenantA, '').expect(400);
  });

  it('geçersiz taxId/e-posta şemaca reddedilir', async () => {
    await createCustomer(tenantA, 'Tax Test', { taxId: '1234' }).expect(400);
    await createCustomer(tenantA, 'Mail Test', {
      primaryContact: { name: 'X Kişi', email: 'gecersiz' },
    }).expect(400);
  });

  it('güncelleme ve arşivleme (silme) çalışır', async () => {
    const created = await createCustomer(tenantA, 'Beta Servis').expect(201);
    const id = created.body.customerId as string;

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${id}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ billingAddress: 'Yeni Cad. 9' })
      .expect(200);

    const archived = await request(app.getHttpServer())
      .delete(`/api/v1/customers/${id}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .expect(200);
    expect(archived.body.archived).toBe(true);

    // Varsayılan listede görünmez; status=ARCHIVED filtresinde görünür.
    const defaultList = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(defaultList.body.data.some((c: { name: string }) => c.name === 'Beta Servis')).toBe(
      false,
    );
    const archivedList = await request(app.getHttpServer())
      .get('/api/v1/customers?status=ARCHIVED')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(archivedList.body.data.some((c: { name: string }) => c.name === 'Beta Servis')).toBe(
      true,
    );
  });

  it('olmayan müşteri → 404 (varlık sızıntısı yok)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/customers/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(404);
  });
});

describe('çift kayıt kuralları', () => {
  it('aynı ad (yazım farklarıyla) → 409 CUSTOMER_DUPLICATE', async () => {
    await createCustomer(tenantA, 'Delta Kargo').expect(201);
    const dup = await createCustomer(tenantA, 'delta  KARGO');
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CUSTOMER_DUPLICATE');
    expect(dup.body.details.customerId).toBeTruthy();

    // Türkçe i/İ varyantı da yakalanır.
    const turkish = await createCustomer(tenantA, 'DELTA KARGO');
    expect(turkish.status).toBe(409);
  });

  it('aynı vergi no → 409 TAX_ID_DUPLICATE', async () => {
    await createCustomer(tenantA, 'Epsilon A.Ş.', { taxId: '2222222202' }).expect(201);
    const dup = await createCustomer(tenantA, 'Zeta A.Ş.', { taxId: '2222222202' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('TAX_ID_DUPLICATE');
  });

  it('ad değişikliğinde çakışma denetlenir; aynı kayda sorun yok', async () => {
    const one = await createCustomer(tenantA, 'Eta Üretim').expect(201);
    const two = await createCustomer(tenantA, 'Teta Üretim').expect(201);
    const conflict = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${two.body.customerId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ name: 'eta üretim' });
    expect(conflict.status).toBe(409);

    // Kendi adını yeniden yazmak sorun değil.
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${one.body.customerId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ name: 'Eta Üretim A.Ş.' })
      .expect(200);
  });

  it('kiracılar arası tekillik YOK (aynı ad iki kiracıda serbest)', async () => {
    await createCustomer(tenantA, 'Ortak Ad Ltd').expect(201);
    await createCustomer(tenantB, 'Ortak Ad Ltd').expect(201);
  });
});

describe('arama / filtre / sayfalama', () => {
  it('q araması normalize duyarlı; sayfalama pageInfo tutarlı', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await createCustomer(tenantA, `Sayfalama Firma ${i}`).expect(201);
    }

    const page1 = await request(app.getHttpServer())
      .get('/api/v1/customers?q=sayfalama&pageSize=3&page=1')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(page1.body.data.length).toBe(3);
    expect(page1.body.pageInfo).toEqual({ total: 5, page: 1, pageSize: 3 });

    const page2 = await request(app.getHttpServer())
      .get('/api/v1/customers?q=sayfalama&pageSize=3&page=2')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(page2.body.data.length).toBe(2);

    // Türkçe büyük/küçük harf duyarsız.
    const turkish = await request(app.getHttpServer())
      .get('/api/v1/customers?q=SAYFALAMA')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(turkish.body.pageInfo.total).toBe(5);

    // Sınır: pageSize üst sınırı 100 (şema reddi).
    await request(app.getHttpServer())
      .get('/api/v1/customers?pageSize=500')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(400);
  });

  it('sıralama izin listesi dışı değer sessizce varsayılana döner', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/customers?sort=name;DROP TABLE users')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });
});

describe('kişiler ve lokasyonlar', () => {
  let customerId: string;

  beforeAll(async () => {
    const created = await createCustomer(tenantA, 'Iota Turizm').expect(201);
    customerId = created.body.customerId as string;
  });

  it('kişi CRUD + e-posta çift kaydı', async () => {
    const create = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/contacts`)
        .set('Cookie', cookieHeader(tenantA.cookies))
        .set('x-csrf-token', tenantA.cookies.csrf)
        .send(body);

    const contact = await create({ name: 'Ayşe Can', email: 'ayse@iota.test' }).expect(201);
    const dup = await create({ name: 'Ayşe Can 2', email: 'AYSE@iota.test' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CONTACT_DUPLICATE');

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/contacts/${contact.body.contactId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ phone: '+905550009999' })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/contacts`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(list.body.data.length).toBe(1);

    await request(app.getHttpServer())
      .delete(`/api/v1/customers/contacts/${contact.body.contactId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .expect(200);
  });

  it('lokasyon CRUD + koordinat doğrulama + bağlı varlık koruması', async () => {
    const create = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/locations`)
        .set('Cookie', cookieHeader(tenantA.cookies))
        .set('x-csrf-token', tenantA.cookies.csrf)
        .send(body);

    const location = await create({
      name: 'Ana Tesis',
      address: 'Boğaz Cad. 5',
      city: 'İstanbul',
      latitude: 41.0,
      longitude: 29.0,
    }).expect(201);
    expect(location.body.assetCount).toBe(0);

    // Geçersiz koordinat reddi.
    await create({ address: 'X', latitude: 999 }).expect(400);

    // Varlık bağla → lokasyon silinemez (409 LOCATION_IN_USE).
    await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({
        customerId,
        serviceLocationId: location.body.locationId,
        manufacturer: 'Test Cihazı',
      })
      .expect(201);

    const deleteAttempt = await request(app.getHttpServer())
      .delete(`/api/v1/customers/locations/${location.body.locationId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf);
    expect(deleteAttempt.status).toBe(409);
    expect(deleteAttempt.body.code).toBe('LOCATION_IN_USE');
  });
});

describe('varlık (ekipman) envanteri', () => {
  let customerId: string;

  beforeAll(async () => {
    const created = await createCustomer(tenantA, 'Kappa Enerji').expect(201);
    customerId = created.body.customerId as string;
  });

  it('etiket/seri çift kaydı; otomatik etiket üretimi; hiyerarşi', async () => {
    const create = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/v1/assets')
        .set('Cookie', cookieHeader(tenantA.cookies))
        .set('x-csrf-token', tenantA.cookies.csrf)
        .send({ customerId, ...body });

    const parent = await create({
      assetTag: 'TEST-KAPPA-01',
      manufacturer: 'Siemens',
      model: 'GIS-20',
      serialNumber: 'SN-KAPPA-1',
      criticality: 'HIGH',
    }).expect(201);
    expect(parent.body.assetTag).toBe('TEST-KAPPA-01');

    // Etiket çakışması.
    const tagDup = await create({ assetTag: 'test-kappa-01', manufacturer: 'X' });
    expect(tagDup.status).toBe(409);
    expect(tagDup.body.code).toBe('ASSET_TAG_TAKEN');

    // Seri çakışması (tanımlıysa tekil).
    const serialDup = await create({ assetTag: 'TEST-KAPPA-02', serialNumber: 'SN-KAPPA-1' });
    expect(serialDup.status).toBe(409);
    expect(serialDup.body.code).toBe('SERIAL_TAKEN');

    // Otomatik etiket.
    const auto = await create({ manufacturer: 'Otomatik Etiketli' }).expect(201);
    expect(String(auto.body.assetTag)).toMatch(/^AST-[A-HJ-NP-Z2-9]{6}$/);

    // Hiyerarşi: alt ekipman.
    const child = await create({
      parentAssetId: parent.body.assetId,
      manufacturer: 'Alt Modül',
    }).expect(201);
    expect(child.body.parentAssetId).toBe(parent.body.assetId);

    // Başka kiracının müşteri kimliğiyle varlık → 404 (FK RLS'i atlamaz).
    const foreignCustomer = await createCustomer(tenantB, 'Foreign Hedef').expect(201);
    const cross = await create({ customerId: foreignCustomer.body.customerId });
    expect(cross.status).toBe(404);
  });

  it('durum değişimi olay üretir; emeklilik (silme) RETIRED yapar', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ customerId, assetTag: 'TEST-KAPPA-90', manufacturer: 'Durum Test' })
      .expect(201);
    const assetId = created.body.assetId as string;

    await request(app.getHttpServer())
      .patch(`/api/v1/assets/${assetId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ status: 'INACTIVE' })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/assets/${assetId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .expect(200);

    const asset = await request(app.getHttpServer())
      .get(`/api/v1/assets/${assetId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(asset.body.status).toBe('RETIRED');

    // Geçmiş: created + status_changed + status_changed (retire) olayları.
    const history = await request(app.getHttpServer())
      .get(`/api/v1/assets/${assetId}/history`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    const types = history.body.data.map((e: { eventType: string }) => e.eventType);
    expect(types).toContain('asset.created');
    expect(types).toContain('asset.status_changed:ACTIVE:INACTIVE');
    expect(types).toContain('asset.status_changed:INACTIVE:RETIRED');
  });

  it('varlık arama: etiket/seri/marka/model üzerinden', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/assets?q=kappa')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(list.body.pageInfo.total).toBeGreaterThanOrEqual(2);

    const byCriticality = await request(app.getHttpServer())
      .get('/api/v1/assets?criticality=HIGH')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(
      byCriticality.body.data.every((a: { criticality: string }) => a.criticality === 'HIGH'),
    ).toBe(true);
  });

  it('QR: SVG döner; by-tag çözümleme; bilinmeyen etiket 404', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ customerId, assetTag: 'TEST-QR-1', manufacturer: 'QR Test' })
      .expect(201);

    const qr = await request(app.getHttpServer())
      .get(`/api/v1/assets/${created.body.assetId}/qr`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(qr.headers['content-type']).toContain('image/svg+xml');
    expect(Buffer.from(qr.body).toString('utf8')).toContain('<svg');

    const byTag = await request(app.getHttpServer())
      .get('/api/v1/assets/by-tag/test-qr-1')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(byTag.body.assetTag).toBe('TEST-QR-1');

    await request(app.getHttpServer())
      .get('/api/v1/assets/by-tag/YOK-ETIKET')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(404);
  });

  it('doküman meta + imzalı URL gidiş-dönüşü (RustFS)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ customerId, assetTag: 'TEST-DOC-1', manufacturer: 'Doküman Test' })
      .expect(201);
    const assetId = created.body.assetId as string;

    const document = await request(app.getHttpServer())
      .post(`/api/v1/assets/${assetId}/documents`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ documentType: 'manual', fileName: 'test.txt', contentType: 'text/plain' })
      .expect(201);
    expect(document.body.uploadUrl).toContain('localhost:9000');

    // Yükleme (imzalı PUT) → indirme (imzalı GET) gidiş-dönüşü.
    const put = await fetch(document.body.uploadUrl, {
      method: 'PUT',
      body: 'faz04-belge-icerigi',
    });
    expect(put.status).toBe(200);

    const urlResponse = await request(app.getHttpServer())
      .get(`/api/v1/assets/${assetId}/documents/${document.body.documentId}/url`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    const downloaded = await fetch(urlResponse.body.url);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe('faz04-belge-icerigi');

    // Liste + silme.
    const list = await request(app.getHttpServer())
      .get(`/api/v1/assets/${assetId}/documents`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(list.body.data.length).toBe(1);

    await request(app.getHttpServer())
      .delete(`/api/v1/assets/${assetId}/documents/${document.body.documentId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .expect(200);
  });
});

describe('zaman çizelgesi', () => {
  it('müşteri olayları kronolojik ve kiracı kapsamında', async () => {
    const created = await createCustomer(tenantA, 'Lambda Lojistik', {
      primaryContact: { name: 'L Kontak', email: 'l@lambda.test' },
    }).expect(201);
    const customerId = created.body.customerId as string;

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/timeline`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    const types = timeline.body.data.map((e: { eventType: string }) => e.eventType);
    expect(types).toContain('customer.created');
    expect(types).toContain('contact.created');
  });
});

describe('CSV içe aktarma', () => {
  it('geçerli + çift + hatalı satırlar tek raporda; dryRun yazmaz', async () => {
    const csv = [
      'name,customerType,taxId,contactName,contactEmail,contactPhone',
      'Import Firma 1,COMPANY,3333333301,İthal Bir,bir@import.test,+905550001001',
      'import firma 1,COMPANY,,,,', // dosya içi tekrar
      'Import Firma 2,COMPANY,,,iki@import.test,',
      'A,COMPANY,,,,', // hatalı ad (1 karakter)
      'Import Firma 3,BILINMEYEN,,,,', // hatalı tür
    ].join('\n');

    const dry = await request(app.getHttpServer())
      .post('/api/v1/customers/import')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ csv, dryRun: true })
      .expect(201);
    expect(dry.body.dryRun).toBe(true);
    expect(dry.body.createdCount).toBe(0);
    expect(dry.body.totalRows).toBe(5);
    expect(dry.body.duplicateCount).toBe(1);
    expect(dry.body.errorCount).toBe(2);

    // Gerçek içe aktarma.
    const real = await request(app.getHttpServer())
      .post('/api/v1/customers/import')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ csv })
      .expect(201);
    expect(real.body.createdCount).toBe(2);
    expect(real.body.duplicateCount).toBe(1);

    // Oluşturulanlar gerçekten kayıtlı; kontak da kurulmuş.
    const search = await request(app.getHttpServer())
      .get('/api/v1/customers?q=Import Firma 2')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(search.body.pageInfo.total).toBe(1);
    expect(search.body.data[0].contactCount).toBe(1);

    // Aynı dosyayı tekrar içe aktarma → hepsi çift kayıt (güvenli tekrar).
    const replay = await request(app.getHttpServer())
      .post('/api/v1/customers/import')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ csv })
      .expect(201);
    expect(replay.body.createdCount).toBe(0);
    expect(replay.body.duplicateCount).toBe(3);
  });

  it('bozuk başlık → 400 IMPORT_FORMAT_INVALID', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/customers/import')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ csv: 'yanlis,baslik\nX,Y' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('IMPORT_FORMAT_INVALID');
  });

  it('şablon uç noktası başlık döner', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/customers/import-template')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(response.body.header).toContain('name');
  });
});

describe('kiracı izolasyonu (TEST-04 §4)', () => {
  it('B musterisi A listesinde/aramada gorunmez', async () => {
    await createCustomer(tenantB, 'Secret B Müşterisi').expect(201);
    const list = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(list.body.data.some((c: { name: string }) => c.name === 'Secret B Müşterisi')).toBe(
      false,
    );

    const search = await request(app.getHttpServer())
      .get('/api/v1/customers?q=Secret B')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(200);
    expect(search.body.pageInfo.total).toBe(0);
  });

  it('A, B musteri/kisi/lokasyon/varlik kimlikleriyle yazamaz 404', async () => {
    const bCustomer = await createCustomer(tenantB, 'Hedef B').expect(201);
    const bCustomerId = bCustomer.body.customerId as string;

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${bCustomerId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ billingAddress: 'sızma' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${bCustomerId}/contacts`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ name: 'Sızan Kişi', email: 'siz@ma.test' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${bCustomerId}/locations`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ address: 'sızma adresi' })
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .set('x-csrf-token', tenantA.cookies.csrf)
      .send({ customerId: bCustomerId, manufacturer: 'sızma' })
      .expect(404);

    // Varlık çapraz erişim: B'nin varlığını A okuyamaz/düzenleyemez.
    const bAsset = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .set('x-csrf-token', tenantB.cookies.csrf)
      .send({ customerId: bCustomerId, assetTag: 'B-SECRET-1' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/assets/${bAsset.body.assetId}`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/assets/${bAsset.body.assetId}/history`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/assets/${bAsset.body.assetId}/qr`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/assets/by-tag/B-SECRET-1')
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(404);
    // by-tag'da varlık varlığı SIZMAZ: 404 mesajı genel.
  });

  it('A, B dokümanını indiremez (404) ve zaman çizelgesini göremez', async () => {
    const bCustomer = await createCustomer(tenantB, 'Hedef B2').expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${bCustomer.body.customerId}/timeline`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(404);

    const bAsset = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set('Cookie', cookieHeader(tenantB.cookies))
      .set('x-csrf-token', tenantB.cookies.csrf)
      .send({ customerId: bCustomer.body.customerId, assetTag: 'B-SECRET-2' })
      .expect(201);
    const bDoc = await request(app.getHttpServer())
      .post(`/api/v1/assets/${bAsset.body.assetId}/documents`)
      .set('Cookie', cookieHeader(tenantB.cookies))
      .set('x-csrf-token', tenantB.cookies.csrf)
      .send({ documentType: 'warranty', fileName: 'garanti.pdf' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/assets/${bAsset.body.assetId}/documents/${bDoc.body.documentId}/url`)
      .set('Cookie', cookieHeader(tenantA.cookies))
      .expect(404);
  });

  it('RLS ham kanıt: yanlış kiracı bağlamında customers/assets 0 satır', async () => {
    const wrongContext = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantB.tenantId}, true)`;
      return Promise.all([
        tx.customer.findMany({ where: { tenantId: tenantA.tenantId } }),
        tx.asset.findMany({ where: { tenantId: tenantA.tenantId } }),
      ]);
    });
    expect(wrongContext[0].length).toBe(0);
    expect(wrongContext[1].length).toBe(0);

    // Bağlamsız okuma → 0 (FORCE RLS).
    const bare = await prisma.customer.findMany({ where: { tenantId: tenantA.tenantId } });
    expect(bare.length).toBe(0);
  });
});

describe('rol sınırları (RBAC)', () => {
  it('teknisyen (yalnız view_assigned) müşteri uçlarına erişemez — fail-closed', async () => {
    const technician = await addMember(tenantA, 'tech-crm', 'technician');
    const list = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Cookie', cookieHeader(technician.cookies));
    expect(list.status).toBe(403);
    expect(list.body.code).toBe('FORBIDDEN');

    const create = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Cookie', cookieHeader(technician.cookies))
      .set('x-csrf-token', technician.cookies.csrf)
      .send({ name: 'Teknisyen Firması' });
    expect(create.status).toBe(403);
  });

  it('depo (view_limited) okur ama yazamaz', async () => {
    const warehouse = await addMember(tenantA, 'dep-crm', 'warehouse');
    await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Cookie', cookieHeader(warehouse.cookies))
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/assets')
      .set('Cookie', cookieHeader(warehouse.cookies))
      .expect(200);

    const create = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Cookie', cookieHeader(warehouse.cookies))
      .set('x-csrf-token', warehouse.cookies.csrf)
      .send({ name: 'Depo Firması' });
    expect(create.status).toBe(403);
  });

  it('dispatcher (customers:manage + assets:manage) yazar', async () => {
    const dispatcher = await addMember(tenantA, 'disp-crm', 'dispatcher');
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Cookie', cookieHeader(dispatcher.cookies))
      .set('x-csrf-token', dispatcher.cookies.csrf)
      .send({ name: 'Dispatcher Firması' })
      .expect(201);
  });
});
