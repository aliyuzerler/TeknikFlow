import type { PrismaClient } from '@prisma/client';
import { PERMISSION_CATALOGUE, SYSTEM_ROLES } from './rbac-matrix.js';

/**
 * RBAC kataloğu ve planların idempotent tohumlanması.
 * prisma/seed.ts (CLI) VE entegrasyon testleri aynı kaynağı kullanır —
 * testler katalog olmadan çalışmaz, katalog da tek yerden gelir.
 */
export async function seedRbacCatalogue(prisma: PrismaClient): Promise<void> {
  for (const permission of PERMISSION_CATALOGUE) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: { ...permission },
      update: { description: permission.description, category: permission.category },
    });
  }

  for (const role of SYSTEM_ROLES) {
    // Sistem rolleri tenantId=NULL — tekil indeks kısmi SQL düzeyinde;
    // Prisma tarafında findFirst + create/update (idempotent).
    const existing = await prisma.role.findFirst({ where: { key: role.key, tenantId: null } });
    const created = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: { name: role.name, description: role.description, isSystem: true },
        })
      : await prisma.role.create({
          data: {
            key: role.key,
            name: role.name,
            description: role.description,
            isSystem: true,
          },
        });
    await prisma.rolePermission.deleteMany({ where: { roleId: created.id } });
    await prisma.rolePermission.createMany({
      data: role.permissions.map((permissionKey) => ({ roleId: created.id, permissionKey })),
    });
  }
}

export async function seedPlans(prisma: PrismaClient): Promise<void> {
  const plans = [
    {
      code: 'starter',
      name: 'Başlangıç',
      description: 'Küçük ekipler için temel paket',
      entitlements: [
        { key: 'max_users', limitValue: 5 },
        { key: 'max_branches', limitValue: 1 },
      ],
    },
    {
      code: 'professional',
      name: 'Profesyonel',
      description: 'Büyüyen saha servis ekipleri',
      entitlements: [
        { key: 'max_users', limitValue: 25 },
        { key: 'max_branches', limitValue: 5 },
      ],
    },
    {
      code: 'enterprise',
      name: 'Kurumsal',
      description: 'Sınırsız ölçek, özel dağıtım seçenekleri',
      entitlements: [
        { key: 'max_users', limitValue: null },
        { key: 'max_branches', limitValue: null },
      ],
    },
  ];
  for (const plan of plans) {
    const created = await prisma.plan.upsert({
      where: { code: plan.code },
      create: { code: plan.code, name: plan.name, description: plan.description },
      update: { name: plan.name, description: plan.description, isActive: true },
    });
    for (const entitlement of plan.entitlements) {
      await prisma.planEntitlement.upsert({
        where: { planId_key: { planId: created.id, key: entitlement.key } },
        create: { planId: created.id, ...entitlement, enabled: true },
        update: { limitValue: entitlement.limitValue, enabled: true },
      });
    }
  }
}
