import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { RequestAuthContext } from '../auth/auth-context.js';

/**
 * Faz 03 — platform admin ad alanı (kiracıdan AYRI, ADR-0002).
 *
 * Platform admin: users.platformAdmin=true hesaplar; kiracı üyeliği YOKTUR.
 * Girişte MFA zorunludur (auth.service). Bu uçlar TASARIM gereği çapraz-kiracı
 * okur (platform raporlama) — erişim platformAdmin bayrağıyla sınırlıdır.
 * Kiracı kullanıcısı buraya erişemez (403).
 */
@Controller('platform')
@UseGuards(AuthGuard)
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: TenantScopedPrismaService,
  ) {}

  @Get('tenants')
  async listTenants(@CurrentAuth() ctx: RequestAuthContext) {
    if (!ctx.platformAdmin) {
      throw new ForbiddenException({ message: 'Bu işlem için yetkiniz yok', code: 'FORBIDDEN' });
    }

    // Çapraz-kiracı platform sorgusu — bilinçli platform admin kapsamı.
    const tenants = await this.scoped.withPlatformAdmin((tx) =>
      tx.tenant.findMany({
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          _count: { select: { memberships: true } },
        },
      }),
    );
    return {
      data: tenants.map((t) => ({
        tenantId: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        memberCount: t._count.memberships,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }
}
