import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';

/**
 * Faz 08 — idempotency tekilleştirici (API_CONVENTIONS: "Mutating requests
 * that can be retried accept Idempotency-Key").
 *
 * (kiracı, kullanıcı, kapsam, anahtar) tekil satır; yanıt saklanır ve tekrar
 * aynı yanıt döner. Farklı gövdeyle aynı anahtar → 409 IDEMPOTENCY_KEY_CONFLICT.
 * Anahtar YOKSA normal davranış (tekilleştirme yok).
 *
 * Mobil outbox (ADR-0004) her işlem için UUID anahtar üretir; "duplicate
 * sync" kabul kriteri bu yüzeyden kanıtlanır.
 */

export interface IdempotencyCall<T> {
  tenantId: string;
  userId: string;
  scope: string;
  key: string | undefined;
  body: unknown;
  statusCode: number;
  run: (tx: ScopedClient) => Promise<T>;
}

export interface IdempotencyResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

export function hashRequestBody(body: unknown): string {
  const serialized = JSON.stringify(body ?? null);
  return createHash('sha256').update(serialized).digest('hex');
}

export function idempotencyKeyWhere(input: {
  tenantId: string;
  userId: string;
  scope: string;
  key: string;
}) {
  return {
    tenantId_userId_scope_key: {
      tenantId: input.tenantId,
      userId: input.userId,
      scope: input.scope,
      key: input.key,
    },
  };
}

/**
 * Transaction içinde: önce saklı yanıt ara, yoksa çalıştır + sakla.
 * run() hata fırlatırsa transaction geri alınır — hatalı istek asla
 * "işlenmiş" sayılmaz (yarım kalan idempotency yok).
 */
export async function withIdempotency<T>(
  tx: ScopedClient,
  call: IdempotencyCall<T>,
): Promise<IdempotencyResult<T>> {
  if (!call.key) {
    const body = await call.run(tx);
    return { status: call.statusCode, body, replayed: false };
  }
  const requestHash = hashRequestBody(call.body);
  const existing = await tx.idempotencyKey.findUnique({
    where: idempotencyKeyWhere({
      tenantId: call.tenantId,
      userId: call.userId,
      scope: call.scope,
      key: call.key,
    }),
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        message:
          'Idempotency anahtarı farklı bir gövdeyle daha önce kullanılmış — yeni anahtar gönderin',
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      });
    }
    return {
      status: existing.statusCode,
      body: existing.responseJson as T,
      replayed: true,
    };
  }
  const body = await call.run(tx);
  await tx.idempotencyKey.create({
    data: {
      tenantId: call.tenantId,
      userId: call.userId,
      scope: call.scope,
      key: call.key,
      requestHash,
      responseJson: body as never,
      statusCode: call.statusCode,
    },
  });
  return { status: call.statusCode, body, replayed: false };
}
