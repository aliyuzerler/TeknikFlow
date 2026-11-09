import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import type { AuditEventInput } from '../auth/auth-context.js';

/**
 * Faz 03 — audit kaydı (SECURITY_PRIVACY.md: aktör, eylem, kaynak, kiracı,
 * zaman, istek kimliği ve GÜVENLİ fark).
 *
 * Redaksiyon: bilinen hassas alan adları metadata'dan çıkarılır; yazma başarısız
 * akışı BOZMAZ (audit yan etkisi iş mantığını düşürmez) ama hata loglanır.
 */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'inviteToken',
  'refreshToken',
  'accessToken',
  'csrfToken',
  'authorization',
  'signature',
  'secret',
]);

function redact(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      safe[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 200) {
      safe[key] = `${value.slice(0, 200)}…`;
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: TenantScopedPrismaService,
  ) {}

  async log(event: AuditEventInput): Promise<void> {
    try {
      const row = {
        tenantId: event.tenantId ?? null,
        actorId: event.actorId ?? null,
        actorType: event.actorType ?? 'user',
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        requestId: event.requestId ?? null,
        ip: event.ip?.slice(0, 64) ?? null,
        userAgent: event.userAgent?.slice(0, 300) ?? null,
        metadataJson: redact(event.metadata) as Prisma.InputJsonValue,
      };
      // Kiracı bağlamlı olaylar kiracı kapsamıyla; kiratısız (platform) olaylar
      // platform bayrağıyla yazılır — her ikisi RLS politikalarına uyar.
      if (event.tenantId) {
        await this.scoped.withTenant(event.tenantId, (tx) => tx.auditLog.create({ data: row }));
      } else {
        await this.scoped.withPlatformAdmin((tx) => tx.auditLog.create({ data: row }));
      }
    } catch (error) {
      this.logger.error(
        `audit yazılamadı: action=${event.action} requestId=${event.requestId ?? '-'} → ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Kiracı audit geçmişi (RLS kapsamı denetleyicide zaten kurulur). */
  listForTenant(tenantId: string, page: number, pageSize: number) {
    return this.scoped.withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId },
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    );
  }

  countForTenant(tenantId: string) {
    return this.scoped.withTenant(tenantId, (tx) => tx.auditLog.count({ where: { tenantId } }));
  }

  /** Geliştirme/sistem olayları için doğrudan bağlam (kiracı yok). */
  get prismaClient(): PrismaService {
    return this.prisma;
  }
}
