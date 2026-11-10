import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';

/**
 * Faz 08 — idempotency anahtarı servisi (docs/OFFLINE_SYNC.md §outbox).
 *
 * Mobil outbox her işleme UUID anahtar üretir; aynı anahtarla yeniden
 * gönderim (uçak modu kurtarma, çift dokunuş, ağ kopması) saklanan
 * KANONİK yanıtı oynatır — iş yeniden işlenmez.
 *
 * İş mantığı ve anahtar kaydı AYNI kiracı-kapsamlı transaction'da
 * yürür: çökme anında ikisi birlikte geri alınır (çift imza/çift
 * checklist kaydı yüzeyi kapalı). Eşzamanlı çift gönderimde tekil
 * kısıt devreye girer → işleyen taraf rollback olur, kazananın
 * sakladığı yanıt oynatılır.
 */

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyOutcome<T> {
  body: T;
  replayed: boolean;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly scoped: TenantScopedPrismaService) {}

  /**
   * Anahtar YOKSA handler'ı doğrudan çalıştırır (web akışı — anahtar
   * opsiyonel). Anahtar VARSA: geçerli kayıt → oynat; yok/süresi
   * geçmiş → handler + sonucu sakla (tek transaction).
   */
  async withIdempotency<T>(
    tenantId: string,
    userId: string,
    key: string | undefined,
    endpoint: string,
    handler: (tx: ScopedClient) => Promise<T>,
  ): Promise<IdempotencyOutcome<T>> {
    if (!key) {
      const body = await this.scoped.withTenant(tenantId, handler);
      return { body, replayed: false };
    }

    // 1) Önceki kayıt var mı? (ayrı okuma — hızlı yol)
    const existing = await this.scoped.withTenant(tenantId, async (tx) =>
      tx.idempotencyKey.findUnique({
        where: { tenantId_userId_key: { tenantId, userId, key } },
      }),
    );
    if (existing && existing.expiresAt.getTime() > Date.now()) {
      return { body: existing.responseBody as T, replayed: true };
    }
    if (existing) {
      // Süresi geçmiş → yeniden işlenebilir; eski kaydı temizle.
      await this.scoped.withTenant(tenantId, async (tx) =>
        tx.idempotencyKey.delete({
          where: { tenantId_userId_key: { tenantId, userId, key } },
        }),
      );
    }

    // 2) İş mantığı + anahtar kaydı tek transaction'da.
    try {
      const body = await this.scoped.withTenant(tenantId, async (tx) => {
        const result = await handler(tx);
        await tx.idempotencyKey.create({
          data: {
            tenantId,
            userId,
            key,
            endpoint,
            responseStatus: 200,
            responseBody: result as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
        return result;
      });
      return { body, replayed: false };
    } catch (error) {
      // Tekil kısıt ihlali → eşzamanlı ikinci gönderim kazananı buldu.
      if (isUniqueViolation(error)) {
        const winner = await this.scoped.withTenant(tenantId, async (tx) =>
          tx.idempotencyKey.findUnique({
            where: { tenantId_userId_key: { tenantId, userId, key } },
          }),
        );
        if (winner && winner.expiresAt.getTime() > Date.now()) {
          return { body: winner.responseBody as T, replayed: true };
        }
      }
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
