import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Faz 03 — kiracı kapsamlı veri erişimi (ADR-0003).
 *
 * RLS'li tablolar (branches, memberships, audit_logs, subscriptions) yalnızca
 * bu servis üzerinden erişilmelidir: transaction içinde
 * set_config('app.current_tenant_id', <id>, true) (transaction'a bağlı —
 * havuzlanmış bağlantıda sızıntı yok) ile kiracı bağlamı kurulur.
 *
 * Platform düzeyi sorgular (login sırasında kullanıcı üyeliklerini bulmak,
 * platform admin raporları, kiracı bağlamı olmayan audit kayıtları)
 * withPlatformAdmin kullanır — bilinçli ve denetlenebilir ayrıcalıklı yol.
 */

export type ScopedClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

@Injectable()
export class TenantScopedPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  get raw(): PrismaClient {
    return this.prisma;
  }

  /** Kiracı bağlamlı transaction — RLS'li tablolar için birincil erişim yolu. */
  async withTenant<T>(tenantId: string, fn: (tx: ScopedClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  /** Platform admin bağlamlı transaction — çapraz-kiracı okuma/yazma. */
  async withPlatformAdmin<T>(fn: (tx: ScopedClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
      return fn(tx);
    });
  }
}
