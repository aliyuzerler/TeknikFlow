import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { JwtService } from './token.service.js';
import { sha256 } from './token.service.js';
import { parseBranchScope, type RequestAuthContext } from './auth-context.js';

/**
 * Faz 03 — kimlik doğrulama guard'ı (ADR-0002).
 *
 * İki taşıyıcı:
 * 1. Web: `tf_session` HttpOnly çerezi → Session tablosunda sha256 özetiyle
 *    çözümlenir; ömür/iptal + kullanıcı/üyelik AKTİFLİĞİ her istekte yeniden
 *    doğrulanır (veritabanı tabanlı iptal anında etkili).
 * 2. Mobil: `Authorization: Bearer <JWT>` → imza/ömür doğrulanır; üyelik
 *    AKTİFLİĞİ veritabanından yeniden okunur (token iptali refresh ailesi ile).
 *
 * req.auth'e bağlamı yazar; oturum gerektirmeyen uçlarda uygulanmaz.
 * Kimlik bilgisi yanlış/bayat → 401; hesap/üyelik askıda → 403.
 */

export interface AuthenticatedRequest extends Request {
  auth?: RequestAuthContext;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: TenantScopedPrismaService,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const authorization = request.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      request.auth = await this.resolveBearer(authorization.slice('Bearer '.length));
      return true;
    }

    const cookieToken = readCookie(request.headers.cookie, 'tf_session');
    if (cookieToken) {
      request.auth = await this.resolveSession(cookieToken);
      return true;
    }

    throw new UnauthorizedException({ message: 'Oturum gerekli', code: 'AUTH_REQUIRED' });
  }

  private async resolveBearer(token: string): Promise<RequestAuthContext> {
    const claims = this.jwt.verifyAccessToken(token);
    if (!claims) {
      throw new UnauthorizedException({ message: 'Geçersiz erişim tokenı', code: 'AUTH_INVALID' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ message: 'Geçersiz erişim tokenı', code: 'AUTH_INVALID' });
    }

    // Platform admin JWT'si (üyelik yok) — yalnız platform uçlarında geçerli.
    if (!claims.mid) {
      return {
        kind: 'mobile',
        userId: user.id,
        email: user.emailNormalized,
        displayName: user.displayName,
        platformAdmin: user.platformAdmin,
        permissions: new Set<string>(),
      };
    }

    // Üyelik hâlâ AKTİF mi? (JWT iptal edilemez — aktiflik yeniden doğrulanır.)
    // Kimlik çözümlemesi platform kapsamında: memberships RLS'lidir ve
    // kiracı bağlamı henüz kurulmamıştır (bkz. ADR-0003 bilinçli ayrıcalıklı yol).
    const membership = await this.scoped.withPlatformAdmin((tx) =>
      tx.membership.findUnique({
        where: { id: claims.mid },
        include: { role: true, tenant: true },
      }),
    );
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      membership.userId !== user.id ||
      membership.tenant.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException({
        message: 'Üyelik artık etkin değil',
        code: 'AUTH_MEMBERSHIP_INACTIVE',
      });
    }

    const permissions = await this.prisma.rolePermission.findMany({
      where: { roleId: membership.roleId },
      select: { permissionKey: true },
    });

    return {
      kind: 'mobile',
      userId: user.id,
      email: user.emailNormalized,
      displayName: user.displayName,
      platformAdmin: false,
      membershipId: membership.id,
      tenantId: membership.tenantId,
      tenantName: membership.tenant.name,
      tenantSlug: membership.tenant.slug,
      roleKey: membership.role.key,
      roleName: membership.role.name,
      branchScope: parseBranchScope(membership.branchScope),
      permissions: new Set(permissions.map((p) => p.permissionKey)),
    };
  }

  private async resolveSession(token: string): Promise<RequestAuthContext> {
    // Oturum + üyelik çözümlemesi platform kapsamında (memberships RLS'li;
    // kiracı bağlamı oturumdan TÜRETİLİR — önce çözümleme gerekir).
    const session = await this.scoped.withPlatformAdmin((tx) =>
      tx.session.findUnique({
        where: { tokenHash: sha256(token) },
        include: { user: true, membership: { include: { role: true, tenant: true } } },
      }),
    );

    if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
      throw new UnauthorizedException({ message: 'Oturum geçersiz', code: 'AUTH_REQUIRED' });
    }
    if (session.user.status !== 'ACTIVE') {
      throw new ForbiddenException({ message: 'Hesap erişilemez', code: 'ACCOUNT_INACTIVE' });
    }

    // lastUsedAt dokunuşu (yanıtı geciktirmez, hata akışı bozmaz).
    void this.prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    if (session.membership === null) {
      // Platform admin web oturumu — kiracı bağlamı yok.
      if (!session.user.platformAdmin) {
        throw new ForbiddenException({ message: 'Hesap erişilemez', code: 'ACCOUNT_INACTIVE' });
      }
      return {
        kind: 'web',
        userId: session.user.id,
        email: session.user.emailNormalized,
        displayName: session.user.displayName,
        platformAdmin: true,
        sessionId: session.id,
        permissions: new Set<string>(),
      };
    }

    if (session.membership.status !== 'ACTIVE' || session.membership.tenant.status !== 'ACTIVE') {
      throw new ForbiddenException({
        message: 'Üyelik artık etkin değil',
        code: 'AUTH_MEMBERSHIP_INACTIVE',
      });
    }

    const permissions = await this.prisma.rolePermission.findMany({
      where: { roleId: session.membership.roleId },
      select: { permissionKey: true },
    });

    return {
      kind: 'web',
      userId: session.user.id,
      email: session.user.emailNormalized,
      displayName: session.user.displayName,
      platformAdmin: false,
      sessionId: session.id,
      membershipId: session.membership.id,
      tenantId: session.membership.tenantId,
      tenantName: session.membership.tenant.name,
      tenantSlug: session.membership.tenant.slug,
      roleKey: session.membership.role.key,
      roleName: session.membership.role.name,
      branchScope: parseBranchScope(session.membership.branchScope),
      permissions: new Set(permissions.map((p) => p.permissionKey)),
    };
  }
}

/** Çerez dizgisinden adlandırılmış çerezi ayıklar (cookie-parser'a bağımlılık yok). */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}
