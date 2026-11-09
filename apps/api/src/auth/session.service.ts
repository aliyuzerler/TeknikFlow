import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { generateOpaqueToken, sha256 } from './token.service.js';
import { getEnv } from '../config/env.js';

/**
 * Faz 03 — web oturumları ve mobil refresh aileleri (ADR-0002).
 * Tüm token özetleri sha256 ile saklanır; ham değer DB'ye girmez.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createWebSession(params: {
    userId: string;
    membershipId: string | null;
    ip?: string;
    userAgent?: string;
  }): Promise<{ token: string; csrfToken: string; expiresAt: Date; sessionId: string }> {
    const env = getEnv();
    const token = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.AUTH_SESSION_TTL_HOURS * 3600_000);
    const session = await this.prisma.session.create({
      data: {
        tokenHash: sha256(token),
        userId: params.userId,
        membershipId: params.membershipId,
        kind: 'WEB',
        csrfTokenHash: sha256(csrfToken),
        expiresAt,
        createdIp: params.ip?.slice(0, 64),
        userAgent: params.userAgent?.slice(0, 300),
      },
    });
    return { token, csrfToken, expiresAt, sessionId: session.id };
  }

  async createRefreshToken(params: {
    userId: string;
    membershipId: string;
    familyId?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ token: string; expiresAt: Date; familyId: string }> {
    const env = getEnv();
    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.AUTH_REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000);
    const row = await this.prisma.refreshTokenFamily.create({
      data: {
        familyId: params.familyId ?? crypto.randomUUID(),
        userId: params.userId,
        membershipId: params.membershipId,
        tokenHash: sha256(token),
        expiresAt,
        createdIp: params.ip?.slice(0, 64),
        userAgent: params.userAgent?.slice(0, 300),
      },
    });
    return { token, expiresAt, familyId: row.familyId };
  }

  /**
   * Refresh rotasyonu: eski token geçerli → yeni token (aynı aile) döner.
   * Dönen (rotatedAt set) token yeniden sunulursa YENİDEN KULLANIM tespiti:
   * tüm aile iptal edilir ve güvenlik olayı raporlanır.
   */
  async rotateRefreshToken(presented: string): Promise<
    | {
        ok: true;
        token: string;
        expiresAt: Date;
        familyId: string;
        userId: string;
        membershipId: string;
      }
    | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'REUSE'; familyId?: string }
  > {
    const row = await this.prisma.refreshTokenFamily.findUnique({
      where: { tokenHash: sha256(presented) },
    });
    if (!row || row.revokedAt !== null)
      return { ok: false, reason: 'INVALID', familyId: row?.familyId };
    if (row.expiresAt <= new Date())
      return { ok: false, reason: 'EXPIRED', familyId: row.familyId };
    if (row.rotatedAt !== null || row.reuseDetectedAt !== null) {
      // Yeniden kullanım: ailenin TAMAMI iptal (token hırsızlığı senaryosu).
      await this.prisma.refreshTokenFamily.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: 'reuse_detected',
          reuseDetectedAt: new Date(),
        },
      });
      return { ok: false, reason: 'REUSE' };
    }

    const next = await this.createRefreshToken({
      userId: row.userId,
      membershipId: row.membershipId,
      familyId: row.familyId,
    });
    await this.prisma.refreshTokenFamily.update({
      where: { id: row.id },
      data: { rotatedAt: new Date(), revokedReason: 'rotated' },
    });
    return {
      ok: true,
      token: next.token,
      expiresAt: next.expiresAt,
      familyId: next.familyId,
      userId: row.userId,
      membershipId: row.membershipId,
    };
  }

  async revokeRefreshToken(presented: string): Promise<boolean> {
    const result = await this.prisma.refreshTokenFamily.updateMany({
      where: { tokenHash: sha256(presented), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
    return result.count > 0;
  }

  async revokeSession(sessionId: string, reason: string): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (result.count > 0) return true;
    // Faz 07: kimlik aile kimliği olabilir (mobil cihaz satırı) — ailenin
    // TAMAMINI iptal et (aktif + rotasyonlu satırlar; sonraki refresh geçersiz).
    const family = await this.prisma.refreshTokenFamily.updateMany({
      where: { familyId: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return family.count > 0;
  }

  /** Oturumları listeler (kullanıcının kendisi için; iptaller dahil).
   *  Faz 07: MOBILE satırlar — refresh token aileleri (gruplanmış; en yeni
   *  rotasyon meta'yı taşır, aile etkinliği "rotasyonlanmamış + iptal
   *  edilmemiş" satır varlığıdır). WEB + MOBILE tek listede döner. */
  async listUserSessions(userId: string, currentSessionId?: string, currentFamilyId?: string) {
    const rows = await this.prisma.session.findMany({
      where: { userId, kind: 'WEB' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const views = rows.map((r) => ({
      sessionId: r.id,
      kind: r.kind,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      current: r.id === currentSessionId,
      createdIp: r.createdIp,
      userAgent: r.userAgent,
    }));

    const familyRows = await this.prisma.refreshTokenFamily.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const byFamily = new Map<string, typeof familyRows>();
    for (const row of familyRows) {
      const bucket = byFamily.get(row.familyId) ?? [];
      bucket.push(row);
      byFamily.set(row.familyId, bucket);
    }
    const mobileViews = [...byFamily.entries()].map(([familyId, bucket]) => {
      const latest = bucket[0]!; // createdAt desc — ilk satır en yeni rotasyon
      const activeRow = bucket.find((r) => r.revokedAt === null && r.rotatedAt === null);
      const active = activeRow !== undefined;
      const revokedSource = bucket.find((r) => r.revokedAt !== null);
      return {
        sessionId: familyId,
        kind: 'MOBILE' as const,
        createdAt: latest.createdAt.toISOString(),
        // Aile lastUsedAt taşımaz — son rotasyon zamanı kullanılan en yakın
        // dürüst göstergedir (her başarılı yenileme yeni satır üretir).
        lastUsedAt: latest.createdAt.toISOString(),
        expiresAt: latest.expiresAt.toISOString(),
        revokedAt: active ? null : (revokedSource?.revokedAt?.toISOString() ?? null),
        current: familyId === currentFamilyId,
        createdIp: latest.createdIp,
        userAgent: latest.userAgent,
      };
    });

    return [...views, ...mobileViews];
  }

  /** revoke-all-sessions: kullanıcının tüm oturumlarını iptal eder.
   *  Faz 07: mobil refresh aileleri DAHİL (tüm cihazlar kilitlenir). */
  async revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: {
        userId,
        kind: 'WEB',
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: 'revoke_all' },
    });
    const families = await this.prisma.refreshTokenFamily.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'revoke_all' },
    });
    return result.count + families.count;
  }
}
