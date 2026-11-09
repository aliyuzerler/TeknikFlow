import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';

/**
 * Faz 03 — plan yetkisi iskeleti (billing Faz 14'te tamamlanır).
 * Sunucu tarafı sınır kontrolleri: max_users, max_branches.
 * limitValue=null → sınırsız. Deneme aboneliği de plana bağlıdır.
 */
export const ENTITLEMENT_KEYS = {
  maxUsers: 'max_users',
  maxBranches: 'max_branches',
} as const;

export class PlanLimitExceededError extends Error {
  constructor(
    public readonly key: string,
    public readonly limit: number,
  ) {
    super(`Plan limiti aşıldı: ${key} (limit ${limit})`);
    this.name = 'PlanLimitExceededError';
  }
}

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: TenantScopedPrismaService,
  ) {}

  /** Kiracının plan yetkisi (abonelik yoksa sınırsız varsayar — yalnız iç hata durumunda). */
  async getEntitlement(tenantId: string, key: string): Promise<{ limit: number | null }> {
    // subscriptions RLS'li — kiracı kapsamında okunur.
    const subscription = await this.scoped.withTenant(tenantId, (tx) =>
      tx.subscription.findUnique({
        where: { tenantId },
        include: { plan: { include: { entitlements: true } } },
      }),
    );
    if (!subscription) return { limit: null };
    const entitlement = subscription.plan.entitlements.find((e) => e.key === key);
    if (!entitlement || !entitlement.enabled) return { limit: null };
    return { limit: entitlement.limitValue ?? null };
  }

  /**
   * Kullanıcı limiti: AKTİF üyelikler + AÇIK davetler (yerleşik koltuk) plan
   * limitini aşamaz. Sınır aşımı hata üretir (çağıran 403'e çevirir).
   */
  async assertCanAddUser(tenantId: string): Promise<void> {
    const { limit } = await this.getEntitlement(tenantId, ENTITLEMENT_KEYS.maxUsers);
    if (limit === null) return;
    const occupied = await this.scoped.withTenant(tenantId, async (tx) => {
      const activeMemberships = await tx.membership.count({
        where: { tenantId, status: { in: ['ACTIVE', 'INVITED'] } },
      });
      const openInvitations = await tx.invitation.count({
        where: { tenantId, acceptedAt: null, revokedAt: null },
      });
      return activeMemberships + openInvitations;
    });
    if (occupied >= limit) {
      throw new PlanLimitExceededError(ENTITLEMENT_KEYS.maxUsers, limit);
    }
  }

  /** Şube limiti: mevcut şube sayısı plan limitini aşamaz. */
  async assertCanAddBranch(tenantId: string): Promise<void> {
    const { limit } = await this.getEntitlement(tenantId, ENTITLEMENT_KEYS.maxBranches);
    if (limit === null) return;
    const count = await this.scoped.withTenant(tenantId, (tx) =>
      tx.branch.count({ where: { tenantId } }),
    );
    if (count >= limit) {
      throw new PlanLimitExceededError(ENTITLEMENT_KEYS.maxBranches, limit);
    }
  }
}
