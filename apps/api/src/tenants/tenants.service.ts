import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { generateOpaqueToken, sha256 } from '../auth/token.service.js';
import { getEnv } from '../config/env.js';
import { branchScopeAllows, parseBranchScope } from '../auth/auth-context.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';

/**
 * Faz 03 — kiracı yönetimi: şubeler, üyeler, davetler.
 *
 * Kiracı bağlamı denetleyiciden sunucu tarafında türetilmiş ctx.tenantId ile
 * gelir; tüm kiracı verisi RLS kapsamlı transaction'da okunur/yazılır.
 * Çapraz-kiracı erişim 404 ile reddedilir (varlık sızıntısı yok).
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  // ------------------------- Şubeler -------------------------

  async listBranches(tenantId: string) {
    return this.scoped.withTenant(tenantId, (tx) =>
      tx.branch.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async createBranch(
    tenantId: string,
    input: { name: string; code: string; address?: string; timezone: string },
    actor: { userId: string; requestId?: string; ip?: string; userAgent?: string },
  ) {
    await this.entitlements.assertCanAddBranch(tenantId);
    try {
      const branch = await this.scoped.withTenant(tenantId, (tx) =>
        tx.branch.create({ data: { tenantId, ...input } }),
      );
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'branch.created',
        resourceType: 'branch',
        resourceId: branch.id,
        requestId: actor.requestId,
        ip: actor.ip,
        userAgent: actor.userAgent,
        metadata: { code: branch.code },
      });
      return branch;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({
          message: 'Bu şube kodu kiracı içinde kullanımda',
          code: 'BRANCH_CODE_TAKEN',
        });
      }
      throw error;
    }
  }

  async updateBranch(
    tenantId: string,
    branchId: string,
    input: { name?: string; address?: string | null; timezone?: string },
    actor: { userId: string; branchScope?: 'ALL' | string[] },
  ) {
    // Şube kapsamı rolden AYRI denetlenir (ROLES_PERMISSIONS.md).
    if (!branchScopeAllows(actor.branchScope, branchId)) {
      throw new ForbiddenException({
        message: 'Bu şube kapsamınızın dışında',
        code: 'BRANCH_SCOPE_DENIED',
      });
    }
    return this.scoped.withTenant(tenantId, async (tx) => {
      // RLS zaten kiracıya kısıtlar; bulunamama → 404 (varlık sızıntısı yok).
      const existing = await tx.branch.findFirst({ where: { id: branchId, tenantId } });
      if (!existing) {
        throw new NotFoundException({ message: 'Şube bulunamadı', code: 'NOT_FOUND' });
      }
      return tx.branch.update({ where: { id: branchId }, data: input });
    });
  }

  // ------------------------- Üyeler -------------------------

  async listMembers(tenantId: string) {
    return this.scoped.withTenant(tenantId, (tx) =>
      tx.membership.findMany({
        where: { tenantId },
        include: { user: true, role: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async updateMember(
    tenantId: string,
    membershipId: string,
    input: { membershipStatus?: 'ACTIVE' | 'SUSPENDED'; branchScope?: 'ALL' | string[] },
    actor: { userId: string; requestId?: string },
  ) {
    if (input.branchScope && input.branchScope !== 'ALL') {
      // Kapsam listesindeki şubeler bu kiracıya ait olmalı.
      const branches = await this.scoped.withTenant(tenantId, (tx) =>
        tx.branch.findMany({ where: { tenantId, id: { in: input.branchScope as string[] } } }),
      );
      if (branches.length !== (input.branchScope as string[]).length) {
        throw new BadRequestException({
          message: 'Kapsam listesinde kiracıya ait olmayan şube var',
          code: 'BRANCH_SCOPE_INVALID',
        });
      }
    }

    const result = await this.scoped.withTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: membershipId, tenantId },
        include: { role: true },
      });
      if (!membership) {
        throw new NotFoundException({ message: 'Üye bulunamadı', code: 'NOT_FOUND' });
      }
      if (membership.role.key === 'owner' && input.membershipStatus === 'SUSPENDED') {
        const otherOwners = await tx.membership.count({
          where: {
            tenantId,
            status: 'ACTIVE',
            roleId: membership.roleId,
            id: { not: membershipId },
          },
        });
        if (otherOwners === 0) {
          throw new ConflictException({
            message: 'Son aktif firma sahibi askıya alınamaz',
            code: 'LAST_OWNER_PROTECTED',
          });
        }
      }
      return tx.membership.update({
        where: { id: membershipId },
        data: {
          ...(input.membershipStatus ? { status: input.membershipStatus } : {}),
          ...(input.branchScope ? { branchScope: input.branchScope } : {}),
        },
        include: { user: true, role: true },
      });
    });

    await this.audit.log({
      tenantId,
      actorId: actor.userId,
      action: 'membership.updated',
      resourceType: 'membership',
      resourceId: membershipId,
      requestId: actor.requestId,
      metadata: { fields: Object.keys(input) },
    });
    return result;
  }

  // ------------------------- Davetler -------------------------

  async createInvitation(
    tenantId: string,
    input: { email: string; roleKey: string; branchScope: 'ALL' | string[] },
    actor: { userId: string; requestId?: string; ip?: string; userAgent?: string },
  ): Promise<{ invitationId: string; inviteToken: string; expiresAt: Date }> {
    // Plan limiti: yeni koltuk yerleşmemeli.
    await this.entitlements.assertCanAddUser(tenantId);

    const role = await this.prisma.role.findFirst({
      where: { key: input.roleKey, OR: [{ isSystem: true }, { tenantId }] },
    });
    if (!role) {
      throw new NotFoundException({ message: 'Rol bulunamadı', code: 'ROLE_NOT_FOUND' });
    }

    // Kapsam şubeleri bu kiracıya ait mi?
    if (input.branchScope !== 'ALL') {
      const branches = await this.scoped.withTenant(tenantId, (tx) =>
        tx.branch.findMany({ where: { tenantId, id: { in: input.branchScope as string[] } } }),
      );
      if (branches.length !== (input.branchScope as string[]).length) {
        throw new BadRequestException({
          message: 'Kapsam listesinde kiracıya ait olmayan şube var',
          code: 'BRANCH_SCOPE_INVALID',
        });
      }
    }

    const env = getEnv();
    const inviteToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.AUTH_INVITE_TTL_HOURS * 3600_000);

    try {
      const invitation = await this.scoped.withTenant(tenantId, (tx) =>
        tx.invitation.create({
          data: {
            tenantId,
            emailNormalized: input.email,
            roleId: role.id,
            branchScope: input.branchScope,
            tokenHash: sha256(inviteToken),
            expiresAt,
            invitedByUserId: actor.userId,
          },
        }),
      );
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'invitation.created',
        resourceType: 'invitation',
        resourceId: invitation.id,
        requestId: actor.requestId,
        ip: actor.ip,
        userAgent: actor.userAgent,
        metadata: { roleKey: role.key },
      });
      return { invitationId: invitation.id, inviteToken, expiresAt };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({
          message: 'Bu e-posta için açık davet zaten var',
          code: 'INVITATION_EXISTS',
        });
      }
      throw error;
    }
  }

  async listInvitations(tenantId: string) {
    const rows = await this.scoped.withTenant(tenantId, (tx) =>
      tx.invitation.findMany({
        where: { tenantId },
        include: { role: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
    const now = new Date();
    return rows.map((row) => ({
      invitationId: row.id,
      email: row.emailNormalized,
      roleKey: row.role.key,
      roleName: row.role.name,
      branchScope: parseBranchScope(row.branchScope) ?? 'ALL',
      status: row.acceptedAt
        ? ('ACCEPTED' as const)
        : row.revokedAt
          ? ('REVOKED' as const)
          : row.expiresAt <= now
            ? ('EXPIRED' as const)
            : ('OPEN' as const),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async revokeInvitation(
    tenantId: string,
    invitationId: string,
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const invitation = await tx.invitation.findFirst({ where: { id: invitationId, tenantId } });
      if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
        throw new NotFoundException({ message: 'Davet bulunamadı', code: 'NOT_FOUND' });
      }
      await tx.invitation.update({ where: { id: invitationId }, data: { revokedAt: new Date() } });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'invitation.revoked',
        resourceType: 'invitation',
        resourceId: invitationId,
        requestId: actor.requestId,
      });
      return { revoked: true };
    });
  }

  // ------------------- Davet kabulü (oturum öncesi) -------------------

  /** Herkese açık önizleme: token bilinen tek gerçekliktir; fazlası sızmaz. */
  async previewInvitation(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { tenant: true, role: true },
    });
    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.acceptedAt ||
      invitation.expiresAt <= new Date()
    ) {
      throw new NotFoundException({
        message: 'Davet bulunamadı veya süresi geçti',
        code: 'NOT_FOUND',
      });
    }
    return {
      tenantName: invitation.tenant.name,
      tenantSlug: invitation.tenant.slug,
      invitedEmail: invitation.emailNormalized,
      roleName: invitation.role.name,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Davet kabulü:
   * - Yeni kullanıcı → hesap kurulur (parola seçilir) + üyelik AKTİF.
   * - Mevcut kullanıcı → kimlik doğrulanmış olmalı VE e-postası davetle eşleşmeli.
   */
  async acceptInvitation(
    token: string,
    input: { displayName?: string; password?: string; authenticatedUserId?: string },
    meta: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<{
    userId: string;
    tenantId: string;
    membershipId: string;
    isNewUser: boolean;
    email: string;
  }> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { tenant: true },
    });
    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.acceptedAt ||
      invitation.expiresAt <= new Date()
    ) {
      throw new NotFoundException({
        message: 'Davet bulunamadı veya süresi geçti',
        code: 'NOT_FOUND',
      });
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { emailNormalized: invitation.emailNormalized },
    });

    let userId: string;
    let isNewUser = false;

    if (existingUser) {
      // Mevcut kullanıcı: kimlik doğrulaması + e-posta eşleşmesi zorunlu
      // (davet token'ı e-posta sahipliğini KANITLAMAZ — yalnız bilgi taşır).
      if (!input.authenticatedUserId || input.authenticatedUserId !== existingUser.id) {
        throw new ForbiddenException({
          message: 'Bu daveti kabul etmek için davet edilen hesapla giriş yapın',
          code: 'INVITATION_EMAIL_MISMATCH',
        });
      }
      userId = existingUser.id;
    } else {
      if (!input.password) {
        throw new BadRequestException({
          message: 'Yeni hesap için parola gerekli',
          code: 'PASSWORD_REQUIRED',
        });
      }
      const passwordHash = await this.passwords.hashPassword(input.password);
      const user = await this.prisma.user.create({
        data: {
          emailNormalized: invitation.emailNormalized,
          passwordHash,
          displayName:
            input.displayName ??
            invitation.emailNormalized.split('@')[0] ??
            invitation.emailNormalized,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(), // Davet yoluyla doğrulanmış sayılır.
        },
      });
      userId = user.id;
      isNewUser = true;
    }

    // Üyelik + davet kapanışı tek transaction'da (idempotent değil ama tekil):
    const membership = await this.scoped.withTenant(
      invitation.tenantId,
      async (tx: ScopedClient) => {
        const alreadyMember = await tx.membership.findFirst({
          where: { tenantId: invitation.tenantId, userId },
        });
        if (alreadyMember) {
          await tx.invitation.update({
            where: { id: invitation.id },
            data: { acceptedAt: new Date(), acceptedByUserId: userId },
          });
          return alreadyMember;
        }
        const created = await tx.membership.create({
          data: {
            tenantId: invitation.tenantId,
            userId,
            roleId: invitation.roleId,
            branchScope: invitation.branchScope as object,
            status: 'ACTIVE',
            acceptedAt: new Date(),
          },
        });
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date(), acceptedByUserId: userId },
        });
        return created;
      },
    );

    await this.audit.log({
      tenantId: invitation.tenantId,
      actorId: userId,
      action: isNewUser ? 'invitation.accepted_new_user' : 'invitation.accepted_existing_user',
      resourceType: 'membership',
      resourceId: membership.id,
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      userId,
      tenantId: invitation.tenantId,
      membershipId: membership.id,
      isNewUser,
      email: invitation.emailNormalized,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
