import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient, type Prisma } from '@prisma/client';
import { retryWithBackoff } from '@teknikflow/shared';
import { getEnv } from '../src/config/env.js';
import { seedPlans, seedRbacCatalogue } from '../src/rbac/rbac-catalogue.seed.js';

/**
 * Faz 01 tohumu (seed) — yalnızca altyapı önyüklemesi:
 * 1) Özel obje deposunda (RustFS) tenant verilerinin yaşayacağı bucket'ı hazırlar.
 * 2) app_settings tablosuna önyükleme kayıtlarını yazar.
 *
 * NOT: docs/DEMO_SEED_DATA.md'deki "Atlas Teknik Servis" demo veri seti
 * (şubeler, kullanıcılar, müşteriler, iş emirleri...) kimlik/CRM fazlarıyla
 * birlikte (Faz 03+) eklenir; bu fazda iş modelleri bilinçli olarak YOKTUR.
 */
async function main(): Promise<void> {
  const env = getEnv();

  const s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });

  // Bucket: private varsayılan (anonim erişim RustFS'te kapalıdır).
  // RustFS/Docker ağır yük altında yavaş açılabileceğinden yeniden deneme ile.
  const bucketStatus = await retryWithBackoff(
    async () => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
        return 'mevcut';
      } catch {
        await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
        return 'oluşturuldu';
      }
    },
    { retries: 5, baseMs: 1500, maxWaitMs: 8000, jitter: () => 0.5 },
  );
  console.log(`[seed] bucket '${env.S3_BUCKET}': ${bucketStatus}`);

  const prisma = new PrismaClient();
  try {
    const now = new Date().toISOString();
    const settings: Array<{ key: string; value: string }> = [
      { key: 'bootstrap.version', value: '0.1.0' },
      { key: 'bootstrap.completedAt', value: now },
      { key: 'demo.workspace', value: 'foundation-ready' },
      {
        key: 'demo.note',
        value: 'Atlas Teknik Servis demo verisi Faz 03 ile hazır (kimlik fazı)',
      },
    ];
    for (const setting of settings) {
      await prisma.appSetting.upsert({
        where: { key: setting.key },
        create: setting,
        update: { value: setting.value },
      });
    }
    console.log(`[seed] app_settings: ${settings.length} kayıt güncel`);

    // ---- Faz 03: RBAC kataloğu, sistem rolleri, planlar, demo kiracı ----
    await seedRbacCatalogue(prisma);
    await seedPlans(prisma);
    await seedDemoTenant(prisma);
    console.log(`[seed] Tamamlandı (${now})`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * "Atlas Teknik Servis" DEMO kiracısı (docs/DEMO_SEED_DATA.md — tamamiyle
 * kurgusal; etiketlidir). Parolalar yalnız yerel geliştirme amaçlıdır ve
 * DEMO_SEED_PASSWORD ortam değişkeninden okunur; üretimde ASLA tohumlanmaz.
 * RLS: kiracıya ait yazmalar platform admin kapsamıyla yapılır.
 */
async function seedDemoTenant(prisma: PrismaClient): Promise<void> {
  const demoPassword = process.env.DEMO_SEED_PASSWORD ?? 'Atlas!2026';
  if (getEnv().NODE_ENV === 'production') {
    console.log('[seed] Üretim modunda demo verisi atlanır');
    return;
  }

  const { hash } = await import('@node-rs/argon2');
  const passwordHash = await hash(demoPassword, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

  // RLS bağlamı: demo yazmaları platform kapsamında (tek seferlik önyükleme).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;

    const tenant = await tx.tenant.upsert({
      where: { slug: 'atlas-teknik-servis' },
      create: { name: 'Atlas Teknik Servis', slug: 'atlas-teknik-servis' },
      update: { name: 'Atlas Teknik Servis' },
    });

    const branches = [
      { name: 'İstanbul Merkez', code: 'IST-MRKZ' },
      { name: 'Ankara Servis', code: 'ANK-SRVS' },
    ];
    const branchIds: Record<string, string> = {};
    for (const branch of branches) {
      const created = await tx.branch.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: branch.code } },
        create: { tenantId: tenant.id, ...branch },
        update: { name: branch.name },
      });
      branchIds[branch.code] = created.id;
    }

    const professional = await tx.plan.findUniqueOrThrow({ where: { code: 'professional' } });
    await tx.subscription.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, planId: professional.id, status: 'TRIALING' },
      update: { planId: professional.id },
    });

    // Kullanıcılar: owner, dispatcher, servis yöneticisi, depo, finans,
    // 3 teknisyen (biri Ankara kapsamında). Müşteri portalı kullanıcısı
    // portal kimlikleriyle (Faz 12) gelecek — bilinçli olarak yok.
    const users: Array<{
      email: string;
      name: string;
      role: string;
      scope: 'ALL' | string[];
    }> = [
      { email: 'owner@atlas.example.test', name: 'Ali Yılmaz', role: 'owner', scope: 'ALL' },
      {
        email: 'dispatcher@atlas.example.test',
        name: 'Elif Demir',
        role: 'dispatcher',
        scope: 'ALL',
      },
      {
        email: 'service.manager@atlas.example.test',
        name: 'Mehmet Kaya',
        role: 'service-manager',
        scope: 'ALL',
      },
      { email: 'warehouse@atlas.example.test', name: 'Can Demir', role: 'warehouse', scope: 'ALL' },
      { email: 'finance@atlas.example.test', name: 'Ayşe Tunç', role: 'finance', scope: 'ALL' },
      {
        email: 'technician1@atlas.example.test',
        name: 'Emre Yılmaz',
        role: 'technician',
        scope: 'ALL',
      },
      {
        email: 'technician2@atlas.example.test',
        name: 'Selin Arslan',
        role: 'technician',
        scope: [branchIds['IST-MRKZ'] ?? ''],
      },
      {
        email: 'technician3@atlas.example.test',
        name: 'Burak Koç',
        role: 'technician',
        scope: [branchIds['ANK-SRVS'] ?? ''],
      },
    ];

    let ownerUserId: string | undefined;
    for (const user of users) {
      const account = await tx.user.upsert({
        where: { emailNormalized: user.email },
        create: {
          emailNormalized: user.email,
          passwordHash,
          displayName: user.name,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
        update: { displayName: user.name, status: 'ACTIVE' },
      });
      const role = await tx.role.findFirstOrThrow({
        where: { key: user.role, tenantId: null },
      });
      if (user.role === 'owner') ownerUserId = account.id;
      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: account.id } },
        create: {
          tenantId: tenant.id,
          userId: account.id,
          roleId: role.id,
          branchScope: user.scope,
          status: 'ACTIVE',
          acceptedAt: new Date(),
        },
        update: { roleId: role.id, status: 'ACTIVE', branchScope: user.scope },
      });
    }

    // Demo etiketi: görünür işaret app_settings'te.
    await tx.appSetting.upsert({
      where: { key: 'demo.tenantSlug' },
      create: { key: 'demo.tenantSlug', value: 'atlas-teknik-servis' },
      update: { value: 'atlas-teknik-servis' },
    });

    // ---- Faz 04: demo CRM verisi (docs/DEMO_SEED_DATA.md — kurgusal) ----
    await seedDemoCrm(tx, tenant.id, ownerUserId ?? '');
  });

  console.log(
    `[seed] Demo kiracı 'atlas-teknik-servis': 2 şube, 8 kullanıcı + demo CRM (parola: DEMO_SEED_PASSWORD)`,
  );
}

/**
 * Demo CRM verisi: 3 müşteri, kişiler, lokasyonlar, ekipmanlar ve olaylar.
 * Etiketler AST-DMxx biçiminde (deterministik — E2E/testler bunlara güvenebilir).
 */
async function seedDemoCrm(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ownerId: string,
): Promise<void> {
  const { normalizeName } = await import('../src/crm/crm-utils.js');

  const customers: Array<{
    name: string;
    taxId: string;
    billingAddress: string;
    contacts: Array<{ name: string; email: string; phone: string }>;
    locations: Array<{
      name: string;
      address: string;
      city: string;
      district: string;
      latitude: number;
      longitude: number;
    }>;
    assets: Array<{
      tag: string;
      manufacturer: string;
      model: string;
      serial: string;
      locationIdx: number;
      criticality: 'LOW' | 'MEDIUM' | 'HIGH';
    }>;
  }> = [
    {
      name: 'Marmara Gıda Fabrikası',
      taxId: '1234567801',
      billingAddress: 'Gebze OSB, 200. Sk. No:14, Kocaeli',
      contacts: [
        {
          name: 'Deniz Aydın',
          email: 'deniz.aydin@marmaragida.example.test',
          phone: '+905321110001',
        },
        { name: 'Kemal Gür', email: 'kemal.gur@marmaragida.example.test', phone: '+905321110002' },
      ],
      locations: [
        {
          name: 'Ana Üretim Tesisi',
          address: 'Gebze OSB, 200. Sk. No:14',
          city: 'Kocaeli',
          district: 'Gebze',
          latitude: 40.8003,
          longitude: 29.4395,
        },
        {
          name: 'Soğuk Hava Deposu',
          address: 'Gebze OSB, 202. Sk. No:3',
          city: 'Kocaeli',
          district: 'Gebze',
          latitude: 40.8021,
          longitude: 29.4368,
        },
      ],
      assets: [
        {
          tag: 'AST-DM001',
          manufacturer: 'Bock',
          model: 'HGZ5 Compressor',
          serial: 'SN-BOCK-001',
          locationIdx: 0,
          criticality: 'HIGH',
        },
        {
          tag: 'AST-DM002',
          manufacturer: 'Carrier',
          model: '30RQ Rooftop',
          serial: 'SN-CARR-002',
          locationIdx: 0,
          criticality: 'MEDIUM',
        },
        {
          tag: 'AST-DM003',
          manufacturer: 'Grundfos',
          model: 'NB 65-200 Pump',
          serial: 'SN-GRUN-003',
          locationIdx: 1,
          criticality: 'MEDIUM',
        },
      ],
    },
    {
      name: 'Kuzey Plaza Yönetimi',
      taxId: '1234567802',
      billingAddress: 'Levent Mah. Büyükdere Cad. No:87, İstanbul',
      contacts: [
        { name: 'Sibel Ak', email: 'sibel.ak@kuzeyplaza.example.test', phone: '+905322220001' },
      ],
      locations: [
        {
          name: 'Kuzey Plaza A Blok',
          address: 'Büyükdere Cad. No:87',
          city: 'İstanbul',
          district: 'Levent',
          latitude: 41.0811,
          longitude: 29.0249,
        },
      ],
      assets: [
        {
          tag: 'AST-DM004',
          manufacturer: 'Daikin',
          model: 'HVAC Santral-02',
          serial: 'SN-DAIK-004',
          locationIdx: 0,
          criticality: 'HIGH',
        },
      ],
    },
    {
      name: 'Eksen Makine',
      taxId: '1234567803',
      billingAddress: 'İkitelli OSB, Metal Sk. No:22, İstanbul',
      contacts: [
        { name: 'Ferhat Öz', email: 'ferhat.oz@eksenmakine.example.test', phone: '+905323330001' },
      ],
      locations: [
        {
          name: 'Üretim Atölyesi',
          address: 'İkitelli OSB, Metal Sk. No:22',
          city: 'İstanbul',
          district: 'İkitelli',
          latitude: 41.0736,
          longitude: 28.8069,
        },
      ],
      assets: [
        {
          tag: 'AST-DM005',
          manufacturer: 'Haas',
          model: 'CNC Soğutma Ünitesi',
          serial: 'SN-HAAS-005',
          locationIdx: 0,
          criticality: 'HIGH',
        },
        {
          tag: 'AST-DM006',
          manufacturer: 'Cat',
          model: 'Jeneratör-01',
          serial: 'SN-CAT-006',
          locationIdx: 0,
          criticality: 'MEDIUM',
        },
      ],
    },
  ];

  for (const customer of customers) {
    const before = await tx.customer.findFirst({
      where: { tenantId, nameNormalized: normalizeName(customer.name) },
      select: { id: true },
    });
    const created = await tx.customer.upsert({
      where: {
        tenantId_nameNormalized: { tenantId, nameNormalized: normalizeName(customer.name) },
      },
      create: {
        tenantId,
        name: customer.name,
        nameNormalized: normalizeName(customer.name),
        taxId: customer.taxId,
        billingAddress: customer.billingAddress,
        createdById: ownerId,
      },
      update: {},
    });
    const isNew = !before;

    for (const contact of customer.contacts) {
      const emailNormalized = contact.email.toLowerCase();
      await tx.contact.upsert({
        where: {
          tenantId_customerId_emailNormalized: {
            tenantId,
            customerId: created.id,
            emailNormalized,
          },
        },
        create: {
          tenantId,
          customerId: created.id,
          name: contact.name,
          email: contact.email,
          emailNormalized,
          phone: contact.phone,
        },
        update: {},
      });
    }

    const locationIds: string[] = [];
    for (const location of customer.locations) {
      const existing = await tx.serviceLocation.findFirst({
        where: { tenantId, customerId: created.id, address: location.address },
      });
      const saved = existing
        ? existing
        : await tx.serviceLocation.create({
            data: { tenantId, customerId: created.id, ...location },
          });
      locationIds.push(saved.id);
    }

    for (const asset of customer.assets) {
      await tx.asset.upsert({
        where: { tenantId_assetTag: { tenantId, assetTag: asset.tag } },
        create: {
          tenantId,
          customerId: created.id,
          serviceLocationId: locationIds[asset.locationIdx] ?? null,
          assetTag: asset.tag,
          serialNumber: asset.serial,
          manufacturer: asset.manufacturer,
          model: asset.model,
          criticality: asset.criticality,
          createdById: ownerId,
        },
        update: {},
      });
    }

    if (isNew) {
      // Olaylar yalnızca ilk tohumlamada yazılır (idempotent koşumlar
      // zaman çizelgesini doldurmasın).
      await tx.crmEvent.create({
        data: {
          tenantId,
          customerId: created.id,
          eventType: 'customer.created',
          actorId: ownerId,
          metadataJson: { seeded: true, name: customer.name },
        },
      });
    }
  }
}

main().catch((error) => {
  console.error('[seed] Başarısız:', error);
  process.exit(1);
});
