/**
 * Faz 03 — istek başına kimlik doğrulama bağlamı.
 *
 * Tenant kimliği DAİMA sunucuda üyelik kaydından türetilir (ADR-0003);
 * istemciden gelen tenant kimliği yalnız doğrulanan bir "seçici"dir.
 */

export type BranchScope = 'ALL' | string[];

export interface RequestAuthContext {
  /** web: opak oturum; mobile: kısa ömürlü JWT. */
  kind: 'web' | 'mobile';
  userId: string;
  email: string;
  displayName: string;
  platformAdmin: boolean;
  /** Web oturum kimliği (revoke hedefi). */
  sessionId?: string;
  /** Aktif üyelik bağlamı — platform admin oturumlarında yoktur. */
  membershipId?: string;
  tenantId?: string;
  tenantName?: string;
  tenantSlug?: string;
  roleKey?: string;
  roleName?: string;
  branchScope?: BranchScope;
  permissions: Set<string>;
}

export interface AuditEventInput {
  tenantId?: string;
  actorId?: string;
  actorType?: 'user' | 'system' | 'platform_admin';
  action: string;
  resourceType: string;
  resourceId?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  /** Yalnız güvenli fark/özet — parola, token, imza ASLA girmez. */
  metadata?: Record<string, unknown>;
}

/** Şube kapsamı denetimi: "ALL" ya da liste üyeliği (rol denetiminden AYRI). */
export function branchScopeAllows(scope: BranchScope | undefined, branchId: string): boolean {
  if (scope === undefined) return false;
  if (scope === 'ALL') return true;
  return Array.isArray(scope) && scope.includes(branchId);
}

/** Prisma Json alanından güvenli kapsamı okur (bozuk veri → kapsamsız). */
export function parseBranchScope(value: unknown): BranchScope | undefined {
  if (value === 'ALL') return 'ALL';
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value as string[];
  }
  return undefined;
}
