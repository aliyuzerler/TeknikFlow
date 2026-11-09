import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { isKnownPermission, SYSTEM_ROLE_KEYS } from './rbac-matrix.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';

/**
 * Faz 03 — rol/izin servisi.
 *
 * Özel roller: kiracı yalnız KATALOGDAKİ izinlerden seçim yapabilir;
 * sistem rol anahtarları özel rol olarak ele geçirilemez (ayrıcalık yükseltme yok).
 * Rol yazma işlemleri kiracı bağlamlı transaction'da (RLS) çalışır.
 */
@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: TenantScopedPrismaService,
  ) {}

  /** Katalog (herkese açık — rol tasarlarken seçim için). */
  async listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
  }

  /** Kiracının kullanabildiği roller: sistem + kiracının kendi özel rolleri. */
  async listRolesForTenant(tenantId: string) {
    return this.prisma.role.findMany({
      where: { OR: [{ isSystem: true }, { tenantId }] },
      include: { rolePermissions: { select: { permissionKey: true } } },
      orderBy: [{ isSystem: 'desc' }, { key: 'asc' }],
    });
  }

  async createCustomRole(
    tenantId: string,
    input: { key: string; name: string; description?: string; permissions: string[] },
  ) {
    if (SYSTEM_ROLE_KEYS.has(input.key)) {
      throw new ConflictException({
        message: 'Sistem rol anahtarı özel rol olarak kullanılamaz',
        code: 'ROLE_KEY_RESERVED',
      });
    }
    const unknown = input.permissions.filter((p) => !isKnownPermission(p));
    if (unknown.length > 0) {
      throw new BadRequestException({
        message: `Katalogda olmayan izinler: ${unknown.join(', ')}`,
        code: 'PERMISSION_UNKNOWN',
      });
    }

    return this.scoped.withTenant(tenantId, async (tx: ScopedClient) => {
      const existing = await tx.role.findFirst({ where: { tenantId, key: input.key } });
      if (existing) {
        throw new ConflictException({
          message: 'Bu rol anahtarı kullanımda',
          code: 'ROLE_KEY_TAKEN',
        });
      }
      return tx.role.create({
        data: {
          tenantId,
          key: input.key,
          name: input.name,
          description: input.description,
          isSystem: false,
          rolePermissions: {
            create: input.permissions.map((permissionKey) => ({ permissionKey })),
          },
        },
        include: { rolePermissions: { select: { permissionKey: true } } },
      });
    });
  }

  /** Üyelik rolünü değiştir — son AKTİF owner indirgenemez (hizmet sürekliliği). */
  async changeMemberRole(tenantId: string, membershipId: string, roleKey: string) {
    return this.scoped.withTenant(tenantId, async (tx: ScopedClient) => {
      const membership = await tx.membership.findUnique({
        where: { id: membershipId },
        include: { role: true },
      });
      if (!membership || membership.tenantId !== tenantId) {
        throw new NotFoundException({ message: 'Üye bulunamadı', code: 'NOT_FOUND' });
      }

      if (membership.role.key === 'owner') {
        const otherActiveOwners = await tx.membership.count({
          where: {
            tenantId,
            status: 'ACTIVE',
            roleId: membership.roleId,
            id: { not: membershipId },
          },
        });
        if (otherActiveOwners === 0 && roleKey !== 'owner') {
          throw new ConflictException({
            message: 'Son aktif firma sahibi indirgenemez',
            code: 'LAST_OWNER_PROTECTED',
          });
        }
      }

      const targetRole = await tx.role.findFirst({
        where: { key: roleKey, OR: [{ isSystem: true }, { tenantId }] },
      });
      if (!targetRole) {
        throw new NotFoundException({ message: 'Rol bulunamadı', code: 'ROLE_NOT_FOUND' });
      }

      return tx.membership.update({
        where: { id: membershipId },
        data: { roleId: targetRole.id },
        include: { role: true },
      });
    });
  }
}
