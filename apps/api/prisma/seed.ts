import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import {
  PrismaClient,
  type Prisma,
  type WorkOrderStatus as WorkOrderStatusEnum,
} from '@prisma/client';
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

    // ---- Faz 05: demo servis akışı (talepler + iş emirleri) ----
    await seedDemoService(tx, tenant.id, ownerUserId ?? '');
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

/**
 * Faz 05 — demo servis akışı verisi (docs/DEMO_SEED_DATA.md — kurgusal):
 * kategoriler, SLA politikaları, 3 servis talebi ve 8 iş emri (tüm ana
 * durumlarda). Numaralar deterministiktir (WO-YYYY-0001..0008) ve sayaç
 * tablosu senkron tutulur; koşum idempotenttir (upsert + yalnız ilk
 * tohumlamada olay/not yazılır).
 */
async function seedDemoService(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ownerId: string,
): Promise<void> {
  const { normalizeName } = await import('../src/crm/crm-utils.js');

  // ---- Kategoriler ----
  const categories: Array<{ key: string; name: string; description: string }> = [
    { key: 'hvac', name: 'İklimlendirme', description: 'Soğutma, ısıtma ve havalandırma' },
    { key: 'electrical', name: 'Elektrik', description: 'Elektrik panosu ve güç sistemleri' },
    { key: 'mechanical', name: 'Mekanik', description: 'Pompa, kompresör ve mekanik parçalar' },
    { key: 'plumbing', name: 'Tesisat', description: 'Su ve sıhhi tesisat' },
    { key: 'inspection', name: 'Periyodik Muayene', description: 'Bakım ve denetim kontrolleri' },
    { key: 'other', name: 'Diğer', description: 'Sınıflandırılmamış talepler' },
  ];
  for (const category of categories) {
    await tx.serviceCategory.upsert({
      where: { tenantId_key: { tenantId, key: category.key } },
      create: { tenantId, ...category },
      update: { name: category.name, description: category.description },
    });
  }

  // ---- SLA politikaları (dakika) ----
  const slaPolicies: Array<{
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    resolveMinutes: number;
  }> = [
    { priority: 'URGENT', resolveMinutes: 240 },
    { priority: 'HIGH', resolveMinutes: 480 },
    { priority: 'MEDIUM', resolveMinutes: 1440 },
    { priority: 'LOW', resolveMinutes: 4320 },
  ];
  for (const policy of slaPolicies) {
    await tx.slaPolicy.upsert({
      where: { tenantId_priority: { tenantId, priority: policy.priority } },
      create: { tenantId, ...policy },
      update: { resolveMinutes: policy.resolveMinutes },
    });
  }

  const categoryByKey = new Map(
    (await tx.serviceCategory.findMany({ where: { tenantId } })).map((c) => [c.key, c]),
  );
  const customerByName = new Map(
    (await tx.customer.findMany({ where: { tenantId } })).map((c) => [c.nameNormalized, c]),
  );
  const assetByTag = new Map(
    (await tx.asset.findMany({ where: { tenantId } })).map((a) => [a.assetTag, a]),
  );
  const branches = await tx.branch.findMany({ where: { tenantId } });
  const branchByCode = new Map(branches.map((b) => [b.code, b]));

  // Teknisyenler (atamalar için).
  const technicianRole = await tx.role.findFirstOrThrow({
    where: { key: 'technician', tenantId: null },
  });
  const technicianMemberships = await tx.membership.findMany({
    where: { tenantId, roleId: technicianRole.id, status: 'ACTIVE' },
    include: { user: true },
  });
  const technicianByName = new Map(
    technicianMemberships.map((m) => [m.user.displayName, m.user.id]),
  );
  const emre = technicianByName.get('Emre Yılmaz') ?? ownerId;
  const selin = technicianByName.get('Selin Arslan') ?? emre;

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const year = new Date().getUTCFullYear();
  const no = (n: number) => `WO-${year}-${String(n).padStart(4, '0')}`;

  // ---- 3 servis talebi ----
  const requestSpecs: Array<{
    customer: string;
    assetTag: string;
    categoryKey: string;
    source: 'PORTAL' | 'OFFICE' | 'EMAIL' | 'API';
    subject: string;
    description: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    status: 'NEW' | 'IN_REVIEW' | 'CONVERTED' | 'CANCELLED';
    createdAtDaysAgo: number;
    linkedWorkOrderNo?: number;
  }> = [
    {
      customer: 'MARMARA GIDA FABRIKASI',
      assetTag: 'AST-DM001',
      categoryKey: 'mechanical',
      source: 'PORTAL',
      subject: 'Kompresör yüksek ses ve titreşim',
      description: 'Üretim hattı kompresörü anormal ses çıkarıyor; titreşim artmış durumda.',
      priority: 'URGENT',
      status: 'NEW',
      createdAtDaysAgo: 0.2,
    },
    {
      customer: 'KUZEY PLAZA YÖNETİMİ',
      assetTag: 'AST-DM004',
      categoryKey: 'hvac',
      source: 'EMAIL',
      subject: 'Santral periyodik bakım talebi',
      description: 'A blok HVAC santrali için yıllık bakım planlanmak isteniyor.',
      priority: 'MEDIUM',
      status: 'IN_REVIEW',
      createdAtDaysAgo: 1,
    },
    {
      customer: 'EKSEN MAKINE',
      assetTag: 'AST-DM005',
      categoryKey: 'mechanical',
      source: 'OFFICE',
      subject: 'CNC soğutma ünitesi aşırı ısınıyor',
      description: 'CNC soğutma ünitesi uzun devrelerde aşırı ısınma korumasına giriyor.',
      priority: 'HIGH',
      status: 'CONVERTED',
      createdAtDaysAgo: 3,
      linkedWorkOrderNo: 3,
    },
  ];

  for (const spec of requestSpecs) {
    const existing = await tx.serviceRequest.findFirst({
      where: { tenantId, subject: spec.subject },
      select: { id: true, convertedWorkOrder: { select: { id: true } } },
    });
    if (existing) continue;
    const customer = customerByName.get(normalizeName(spec.customer));
    if (!customer) continue;
    const asset = assetByTag.get(spec.assetTag) ?? null;
    const category = categoryByKey.get(spec.categoryKey) ?? null;
    const createdAt = new Date(now - spec.createdAtDaysAgo * DAY);
    const resolveMinutes =
      slaPolicies.find((p) => p.priority === spec.priority)?.resolveMinutes ?? 1440;
    await tx.serviceRequest.create({
      data: {
        tenantId,
        customerId: customer.id,
        assetId: asset?.id ?? null,
        categoryId: category?.id ?? null,
        source: spec.source,
        subject: spec.subject,
        description: spec.description,
        priority: spec.priority,
        status: spec.status,
        slaDueAt: new Date(createdAt.getTime() + resolveMinutes * 60_000),
        createdById: ownerId,
        createdAt,
        updatedAt: createdAt,
      },
    });
    await tx.crmEvent.create({
      data: {
        tenantId,
        customerId: customer.id,
        assetId: asset?.id ?? null,
        eventType: 'service_request.created',
        actorId: ownerId,
        metadataJson: {
          seeded: true,
          subject: spec.subject,
          priority: spec.priority,
          requestId: (
            await tx.serviceRequest.findFirst({
              where: { tenantId, subject: spec.subject },
              select: { id: true },
            })
          )?.id,
        },
        occurredAt: createdAt,
      },
    });
  }

  // ---- 8 iş emri: tüm ana durumlar ----
  interface WoSpec {
    n: number;
    customer: string;
    assetTag: string;
    branchCode: string;
    type: 'CORRECTIVE' | 'PREVENTIVE' | 'INSTALLATION' | 'INSPECTION' | 'OTHER';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    status:
      | 'DRAFT'
      | 'PLANNED'
      | 'ASSIGNED'
      | 'ACCEPTED'
      | 'EN_ROUTE'
      | 'ON_SITE'
      | 'IN_PROGRESS'
      | 'WAITING_PARTS'
      | 'WAITING_CUSTOMER'
      | 'COMPLETED'
      | 'CLOSED'
      | 'CANCELLED';
    subject: string;
    description: string;
    assignee?: string;
    createdDaysAgo: number;
    scheduleStartInDays?: number;
    scheduleHours?: number;
    cancelledFrom?: string;
    reason?:
      | 'CUSTOMER_REQUEST'
      | 'DUPLICATE'
      | 'OUT_OF_SCOPE'
      | 'PARTS_UNAVAILABLE'
      | 'SCHEDULE_CONFLICT'
      | 'OTHER';
  }
  const woSpecs: WoSpec[] = [
    {
      n: 1,
      customer: 'EKSEN MAKINE',
      assetTag: 'AST-DM006',
      branchCode: 'IST-MRKZ',
      type: 'PREVENTIVE',
      priority: 'MEDIUM',
      status: 'CLOSED',
      subject: 'Jeneratör yıllık bakımı',
      description: 'Yıllık önleyici bakım: yağ ve filtre değişimi, yük testi.',
      assignee: emre,
      createdDaysAgo: 20,
      scheduleStartInDays: -18,
      scheduleHours: 4,
    },
    {
      n: 2,
      customer: 'KUZEY PLAZA YÖNETİMİ',
      assetTag: 'AST-DM004',
      branchCode: 'IST-MRKZ',
      type: 'CORRECTIVE',
      priority: 'HIGH',
      status: 'COMPLETED',
      subject: 'Santral filtre değişimi ve kontrol',
      description: 'Filtre seti değişimi, kayış kontrolü ve genel performans testi.',
      assignee: selin,
      createdDaysAgo: 5,
      scheduleStartInDays: -1,
      scheduleHours: 3,
    },
    {
      n: 3,
      customer: 'EKSEN MAKINE',
      assetTag: 'AST-DM005',
      branchCode: 'IST-MRKZ',
      type: 'CORRECTIVE',
      priority: 'HIGH',
      status: 'WAITING_PARTS',
      subject: 'CNC soğutma ünitesi aşırı ısınma arızası',
      description: 'Isı eşanjörü tıkalı; yedek parça (eşanjör) tedariki bekleniyor.',
      assignee: emre,
      createdDaysAgo: 3,
      scheduleStartInDays: -2,
      scheduleHours: 4,
    },
    {
      n: 4,
      customer: 'MARMARA GIDA FABRIKASI',
      assetTag: 'AST-DM001',
      branchCode: 'IST-MRKZ',
      type: 'CORRECTIVE',
      priority: 'URGENT',
      status: 'ASSIGNED',
      subject: 'Kompresör acil arıza girişimi',
      description: 'Yüksek ses ve titreşim; muhtemel yatak aşınması.',
      assignee: emre,
      createdDaysAgo: 0.5,
      scheduleStartInDays: 0.5,
      scheduleHours: 4,
    },
    {
      n: 5,
      customer: 'MARMARA Gıda FABRIKASI',
      assetTag: 'AST-DM002',
      branchCode: 'IST-MRKZ',
      type: 'CORRECTIVE',
      priority: 'MEDIUM',
      status: 'IN_PROGRESS',
      subject: 'Çatı ünitesi sızıntı onarımı',
      description: 'Soğuk hava deposu çatı ünitesinde refrigerant sızıntısı.',
      assignee: selin,
      createdDaysAgo: 2,
      scheduleStartInDays: -0.2,
      scheduleHours: 6,
    },
    {
      n: 6,
      customer: 'KUZEY PLAZA YÖNETİMİ',
      assetTag: 'AST-DM004',
      branchCode: 'ANK-SRVS',
      type: 'INSPECTION',
      priority: 'LOW',
      status: 'PLANNED',
      subject: 'Yangın güvenlik panosu denetimi',
      description: 'Yıllık elektrik panosu termal kamera denetimi.',
      createdDaysAgo: 1,
      scheduleStartInDays: 3,
      scheduleHours: 2,
    },
    {
      n: 7,
      customer: 'EKSEN MAKINE',
      assetTag: 'AST-DM006',
      branchCode: 'IST-MRKZ',
      type: 'CORRECTIVE',
      priority: 'LOW',
      status: 'CANCELLED',
      subject: 'Jeneratör ses yalıtımı (mükerrer)',
      description: 'Mükerrer talep — yıllık bakım kapsamında ele alındı.',
      createdDaysAgo: 10,
      cancelledFrom: 'DRAFT',
      reason: 'DUPLICATE',
    },
    {
      n: 8,
      customer: 'MARMARA Gıda FABRIKASI',
      assetTag: 'AST-DM003',
      branchCode: 'IST-MRKZ',
      type: 'INSTALLATION',
      priority: 'MEDIUM',
      status: 'DRAFT',
      subject: 'Pompa debi ölçer kurulumu',
      description: 'Soğuk hava deposu pompa hattına debi ölçer takılması.',
      createdDaysAgo: 1,
    },
  ];

  // Durum yolları: hedefe ulaşmak için atılan adımlar (olay/roller için).
  const STATUS_PATH: Record<string, string[]> = {
    DRAFT: [],
    PLANNED: ['PLANNED'],
    ASSIGNED: ['PLANNED', 'ASSIGNED'],
    ACCEPTED: ['PLANNED', 'ASSIGNED', 'ACCEPTED'],
    EN_ROUTE: ['PLANNED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE'],
    ON_SITE: ['PLANNED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE'],
    IN_PROGRESS: ['PLANNED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'],
    WAITING_PARTS: [
      'PLANNED',
      'ASSIGNED',
      'ACCEPTED',
      'EN_ROUTE',
      'ON_SITE',
      'IN_PROGRESS',
      'WAITING_PARTS',
    ],
    WAITING_CUSTOMER: [
      'PLANNED',
      'ASSIGNED',
      'ACCEPTED',
      'EN_ROUTE',
      'ON_SITE',
      'IN_PROGRESS',
      'WAITING_CUSTOMER',
    ],
    COMPLETED: [
      'PLANNED',
      'ASSIGNED',
      'ACCEPTED',
      'EN_ROUTE',
      'ON_SITE',
      'IN_PROGRESS',
      'COMPLETED',
    ],
    CLOSED: [
      'PLANNED',
      'ASSIGNED',
      'ACCEPTED',
      'EN_ROUTE',
      'ON_SITE',
      'IN_PROGRESS',
      'COMPLETED',
      'CLOSED',
    ],
    CANCELLED: ['CANCELLED'],
  };

  for (const spec of woSpecs) {
    const existing = await tx.workOrder.findFirst({
      where: { tenantId, workOrderNo: no(spec.n) },
      select: { id: true },
    });
    if (existing) continue;
    const customer = customerByName.get(normalizeName(spec.customer));
    if (!customer) continue;
    const asset = assetByTag.get(spec.assetTag) ?? null;
    const branch = branchByCode.get(spec.branchCode) ?? null;
    const createdAt = new Date(now - spec.createdDaysAgo * DAY);
    const scheduledStart =
      spec.scheduleStartInDays !== undefined
        ? new Date(now + spec.scheduleStartInDays * DAY)
        : null;
    const scheduledEnd =
      scheduledStart && spec.scheduleHours
        ? new Date(scheduledStart.getTime() + spec.scheduleHours * 60 * 60 * 1000)
        : null;

    // Talep bağlantısı (dönüşüm talebi → 3. iş emri).
    const linkedSubject = spec.n === 3 ? 'CNC soğutma ünitesi aşırı ısınıyor' : null;
    const linkedRequest = linkedSubject
      ? await tx.serviceRequest.findFirst({ where: { tenantId, subject: linkedSubject } })
      : null;

    const created = await tx.workOrder.create({
      data: {
        tenantId,
        workOrderNo: no(spec.n),
        ...(linkedRequest ? { requestId: linkedRequest.id } : {}),
        customerId: customer.id,
        assetId: asset?.id ?? null,
        branchId: branch?.id ?? null,
        type: spec.type,
        priority: spec.priority,
        status: spec.status,
        subject: spec.subject,
        description: spec.description,
        scheduledStart,
        scheduledEnd,
        assignedToId: spec.assignee ?? null,
        version: (STATUS_PATH[spec.status] ?? []).length,
        createdById: ownerId,
        createdAt,
        updatedAt: createdAt,
        ...(spec.status === 'ASSIGNED' || spec.status === 'ACCEPTED' || spec.status === 'EN_ROUTE'
          ? { acceptedAt: new Date(createdAt.getTime() + 30 * 60_000) }
          : {}),
        ...(spec.status === 'EN_ROUTE' ||
        spec.status === 'ON_SITE' ||
        spec.status === 'IN_PROGRESS' ||
        spec.status === 'WAITING_PARTS' ||
        spec.status === 'WAITING_CUSTOMER' ||
        spec.status === 'COMPLETED' ||
        spec.status === 'CLOSED'
          ? {
              acceptedAt: new Date(createdAt.getTime() + 30 * 60_000),
              startedAt: new Date(createdAt.getTime() + 2 * 60 * 60_000),
            }
          : {}),
        ...(spec.status === 'COMPLETED' || spec.status === 'CLOSED'
          ? {
              completedAt: new Date(createdAt.getTime() + 6 * 60 * 60_000),
            }
          : {}),
        ...(spec.status === 'CLOSED'
          ? { closedAt: new Date(createdAt.getTime() + 8 * 60 * 60_000) }
          : {}),
        ...(spec.status === 'CANCELLED'
          ? {
              cancelledAt: new Date(createdAt.getTime() + 2 * 60 * 60_000),
              cancellationReason: spec.reason ?? 'OTHER',
              cancellationNote: 'Demo iptal kaydı',
            }
          : {}),
      },
    });

    // Atama geçmişi + olaylar (yalnız ilk tohumlamada).
    await tx.workOrderEvent.create({
      data: {
        tenantId,
        workOrderId: created.id,
        eventType: 'work_order.created',
        toState: 'DRAFT',
        actorId: ownerId,
        metadataJson: { seeded: true },
        occurredAt: createdAt,
      },
    });
    let previous = 'DRAFT';
    let step = 0;
    for (const state of STATUS_PATH[spec.status] ?? []) {
      step += 1;
      const at = new Date(createdAt.getTime() + step * 45 * 60_000);
      await tx.workOrderEvent.create({
        data: {
          tenantId,
          workOrderId: created.id,
          eventType: 'work_order.state_changed',
          fromState: previous as WorkOrderStatusEnum,
          toState: state as WorkOrderStatusEnum,
          actorId: state === 'ASSIGNED' ? ownerId : (spec.assignee ?? ownerId),
          metadataJson: { seeded: true },
          occurredAt: at,
        },
      });
      if (state === 'ASSIGNED' && spec.assignee) {
        await tx.workOrderAssignment.create({
          data: {
            tenantId,
            workOrderId: created.id,
            userId: spec.assignee,
            assignedById: ownerId,
            status: 'ACTIVE',
            assignedAt: at,
          },
        });
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId: created.id,
            eventType: 'work_order.assigned',
            actorId: ownerId,
            metadataJson: { assigneeUserId: spec.assignee, seeded: true },
            occurredAt: at,
          },
        });
      }
      previous = state;
    }

    if (linkedRequest) {
      await tx.serviceRequest.update({
        where: { id: linkedRequest.id },
        data: { status: 'CONVERTED', updatedAt: new Date() },
      });
    }

    // CRM zaman çizelgesine önemli adımlar.
    for (const major of ['COMPLETED', 'CLOSED', 'CANCELLED']) {
      if (spec.status === major) {
        await tx.crmEvent.create({
          data: {
            tenantId,
            customerId: customer.id,
            assetId: asset?.id ?? null,
            eventType: `work_order.${major.toLowerCase()}`,
            actorId: spec.assignee ?? ownerId,
            metadataJson: { seeded: true, workOrderNo: no(spec.n) },
            occurredAt: createdAt,
          },
        });
      }
    }
  }

  // Notlar (2 dahili + 1 müşteri görünür) — yalnız yeni iş emirlerinde.
  const wo3 = await tx.workOrder.findFirst({ where: { tenantId, workOrderNo: no(3) } });
  if (wo3 && !(await tx.workOrderNote.findFirst({ where: { workOrderId: wo3.id } }))) {
    await tx.workOrderNote.createMany({
      data: [
        {
          tenantId,
          workOrderId: wo3.id,
          authorId: emre,
          body: 'Eşanjör temizlendi; yedek parça tedarik süresi 3 iş günü.',
          visibility: 'INTERNAL',
        },
        {
          tenantId,
          workOrderId: wo3.id,
          authorId: ownerId,
          body: 'Müşteri parça süreci hakkında bilgilendirildi.',
          visibility: 'CUSTOMER',
        },
      ],
    });
  }

  // Sayaç: deterministik numaraların üzerinde (sonraki üretim 0009'dan).
  const maxNo = woSpecs.length;
  const currentYear = new Date().getUTCFullYear();
  const counter = await tx.workOrderCounter.findUnique({
    where: { tenantId_year: { tenantId, year: currentYear } },
  });
  if (!counter || counter.lastNumber < maxNo) {
    await tx.workOrderCounter.upsert({
      where: { tenantId_year: { tenantId, year: currentYear } },
      create: { tenantId, year: currentYear, lastNumber: maxNo },
      update: { lastNumber: maxNo },
    });
  }

  console.log(
    `[seed] Faz 05 demo: ${categories.length} kategori, ${slaPolicies.length} SLA politikası, ` +
      `3 talep + 8 iş emri (WO-${year}-0001..0008)`,
  );
}
