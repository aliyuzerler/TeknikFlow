import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Membership, Role, Tenant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { JwtService } from './token.service.js';
import { getEnv } from '../config/env.js';
import { slugify } from './slug.util.js';

/**
 * Faz 03 — kimlik doğrulama akışları (ADR-0002).
 *
 * Güvenlik ilkeleri burada somutlaşır:
 * - Hata mesajları GENELDİR (hesap sayımını azaltma): bilinmeyen e-posta ile
 *   yanlış parola aynı mesajı alır.
 * - Platform admin girişi MFA zorunlu (model hazır; TOTP akışı ileride).
 * - Tenant bağlamı DAİMA üyelikten türetilir; çoklu üyelikte istemci yalnız
 *   slug SEÇER — sunucu üyeliği doğrular.
 */

const GENERIC_LOGIN_ERROR = 'E-posta veya parola hatalı';

type MembershipWithRoleTenant = Membership & { role: Role; tenant: Tenant };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: TenantScopedPrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async signup(
    input: {
      tenantName: string;
      slug?: string;
      timezone: string;
      user: { displayName: string; email: string; password: string };
    },
    meta: { ip?: string; userAgent?: string; requestId?: string },
  ) {
    const email = input.user.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({ where: { emailNormalized: email } });
    if (existingUser) {
      throw new ConflictException({
        message: 'Bu e-posta ile bir hesap zaten var — giriş yapın',
        code: 'EMAIL_TAKEN',
      });
    }

    // Slug: istemci verdiyse doğrula; yoksa kiracı adından türet + çakışmada ek.
    const desiredSlug = input.slug ?? slugify(input.tenantName);
    const slug = await this.ensureUniqueSlug(desiredSlug);

    const passwordHash = await this.passwords.hashPassword(input.user.password);

    // Kiracı kurulumu platform kapsamında: yeni kiracının bağlamı henüz yok
    // (RLS'li branches/memberships yazmaları bu kapsamda meşrudur).
    const created = await this.scoped.withPlatformAdmin(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.tenantName,
          slug,
          timezone: input.timezone,
        },
      });
      // Varsayılan şube — onboarding adımı (aday kod: MERKEZ).
      const branch = await tx.branch.create({
        data: { tenantId: tenant.id, name: `${input.tenantName} Merkez`, code: 'MERKEZ' },
      });
      // Sistem owner rolü: katalog tohumuyla varOLMALIDIR (seed sorumluluğu).
      const ownerRole = await tx.role.findFirst({ where: { key: 'owner', isSystem: true } });
      if (!ownerRole) {
        throw new ConflictException({
          message: 'Sistem rol kataloğu hazır değil — tohumu çalıştırın',
          code: 'ROLE_CATALOGUE_MISSING',
        });
      }
      const user = await tx.user.create({
        data: {
          emailNormalized: email,
          passwordHash,
          displayName: input.user.displayName,
          status: 'ACTIVE',
        },
      });
      const membership = await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          roleId: ownerRole.id,
          branchScope: 'ALL',
          status: 'ACTIVE',
          acceptedAt: new Date(),
        },
      });
      // Abonelik iskeleti: varsayılan plan ile deneme (billing Faz 14).
      const starterPlan = await tx.plan.findUnique({ where: { code: 'starter' } });
      if (starterPlan) {
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: starterPlan.id,
            status: 'TRIALING',
          },
        });
      }
      return { tenant, branch, user, membership };
    });

    await this.audit.log({
      tenantId: created.tenant.id,
      actorId: created.user.id,
      action: 'tenant.signup',
      resourceType: 'tenant',
      resourceId: created.tenant.id,
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { tenantSlug: created.tenant.slug, branchCode: 'MERKEZ' },
    });

    const webSession = await this.sessions.createWebSession({
      userId: created.user.id,
      membershipId: created.membership.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      tenant: created.tenant,
      membership: created.membership,
      user: created.user,
      session: webSession,
    };
  }

  async login(
    input: { email: string; password: string; client: 'web' | 'mobile'; tenantSlug?: string },
    meta: { ip?: string; userAgent?: string; requestId?: string },
  ) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { emailNormalized: email } });

    // Genel hata: kullanıcı yok / parola yanlış / hesap bayat aynı yanıtı alır.
    if (!user || user.status !== 'ACTIVE') {
      await this.auditFailedLogin(email, meta);
      throw new UnauthorizedException({
        message: GENERIC_LOGIN_ERROR,
        code: 'INVALID_CREDENTIALS',
      });
    }

    const passwordOk = await this.passwords.verifyPassword(user.passwordHash, input.password);
    if (!passwordOk) {
      await this.auditFailedLogin(email, meta);
      throw new UnauthorizedException({
        message: GENERIC_LOGIN_ERROR,
        code: 'INVALID_CREDENTIALS',
      });
    }

    if (user.platformAdmin) {
      // Platform admin ayrımı: MFA zorunlu (SECURITY_PRIVACY.md).
      if (!user.mfaEnabled) {
        throw new ForbiddenException({
          message: 'Platform yöneticisi için MFA etkinleştirilmesi gerekir',
          code: 'PLATFORM_ADMIN_MFA_REQUIRED',
        });
      }
      if (input.client === 'web') {
        const session = await this.sessions.createWebSession({
          userId: user.id,
          membershipId: null,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        await this.audit.log({
          actorId: user.id,
          actorType: 'platform_admin',
          action: 'auth.login',
          resourceType: 'platform_admin',
          resourceId: user.id,
          requestId: meta.requestId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        return { kind: 'platform-web' as const, user, session };
      }
      // Platform admin mobil token'ı: üyeliksiz JWT.
      const env = getEnv();
      const accessToken = this.jwt.signAccessToken(
        { sub: user.id, mid: '', tid: '', role: 'platform-admin' },
        env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      );
      return { kind: 'platform-mobile' as const, user, accessToken };
    }

    // Kiracı bağlamı üyelikten türetilir (ADR-0003) — kimlik çözümlemesi
    // platform kapsamında (memberships RLS'li; kiracı bağlamı henüz seçilmedi).
    const memberships = await this.scoped.withPlatformAdmin((tx) =>
      tx.membership.findMany({
        where: { userId: user.id, status: 'ACTIVE' },
        include: { role: true, tenant: true },
      }),
    );
    const activeMemberships = memberships.filter((m) => m.tenant.status === 'ACTIVE');

    if (activeMemberships.length === 0) {
      await this.auditFailedLogin(email, meta);
      throw new UnauthorizedException({
        message: GENERIC_LOGIN_ERROR,
        code: 'INVALID_CREDENTIALS',
      });
    }

    let membership: MembershipWithRoleTenant;
    if (input.tenantSlug) {
      const selected = activeMemberships.find((m) => m.tenant.slug === input.tenantSlug);
      if (!selected) {
        // Slug bir "seçici"dir: geçersiz seçim genel hata üretir (sayım yok).
        await this.auditFailedLogin(email, meta);
        throw new UnauthorizedException({
          message: GENERIC_LOGIN_ERROR,
          code: 'INVALID_CREDENTIALS',
        });
      }
      membership = selected;
    } else if (activeMemberships.length === 1) {
      membership = activeMemberships[0] as MembershipWithRoleTenant;
    } else {
      // Çoklu üyelik: oturum KURULMAZ — seçim listesi döner.
      return {
        kind: 'selection' as const,
        workspaces: activeMemberships.map((m) => ({
          tenantId: m.tenantId,
          tenantName: m.tenant.name,
          tenantSlug: m.tenant.slug,
          roleKey: m.role.key,
          roleName: m.role.name,
        })),
      };
    }

    const permissions = await this.prisma.rolePermission.findMany({
      where: { roleId: membership.roleId },
      select: { permissionKey: true },
    });

    await this.audit.log({
      tenantId: membership.tenantId,
      actorId: user.id,
      action: 'auth.login',
      resourceType: 'membership',
      resourceId: membership.id,
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (input.client === 'web') {
      const session = await this.sessions.createWebSession({
        userId: user.id,
        membershipId: membership.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { kind: 'web' as const, user, membership, permissions, session };
    }

    const env = getEnv();
    // Faz 07: refresh ailesi ÖNCE kurulur — erişim tokenı `fam` claim'iyle
    // aileyi taşır (cihaz yönetimi: "bu cihaz" işareti + aile iptali).
    const refresh = await this.sessions.createRefreshToken({
      userId: user.id,
      membershipId: membership.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    const accessToken = this.jwt.signAccessToken(
      {
        sub: user.id,
        mid: membership.id,
        tid: membership.tenantId,
        role: membership.role.key,
        fam: refresh.familyId,
      },
      env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    );
    return {
      kind: 'mobile' as const,
      user,
      membership,
      permissions,
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + env.AUTH_ACCESS_TOKEN_TTL_SECONDS * 1000),
      refresh,
    };
  }

  private async auditFailedLogin(
    email: string,
    meta: { ip?: string; requestId?: string; userAgent?: string },
  ) {
    await this.audit.log({
      actorType: 'system',
      action: 'auth.login_failed',
      resourceType: 'auth',
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      // E-posta açık metin yazılmaz — yalnız özet.
      metadata: { emailHash: sha256Short(email) },
    });
  }

  private async ensureUniqueSlug(desired: string): Promise<string> {
    let candidate = desired;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const exists = await this.prisma.tenant.findUnique({ where: { slug: candidate } });
      if (!exists) return candidate;
      candidate = `${desired}-${attempt}`;
    }
    // Kullanıcı sağladıysa çakışma 409; türetilmişse olasılık pratikte sıfır.
    throw new ConflictException({
      message: 'Slug kullanımda, başka bir adres seçin',
      code: 'SLUG_TAKEN',
    });
  }
}

function sha256Short(value: string): string {
  // Kısa özet — audit'te tam e-posta saklamamak için.
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
