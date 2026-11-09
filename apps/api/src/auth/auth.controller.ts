import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  LoginRequestSchema,
  LoginSelectionResponseSchema,
  RefreshRequestSchema,
  SignupRequestSchema,
} from '@teknikflow/contracts';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import { JwtService } from './token.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { AuthGuard } from './auth.guard.js';
import { CurrentAuth } from './auth.decorators.js';
import type { RequestAuthContext } from './auth-context.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { getEnv } from '../config/env.js';

/**
 * Faz 03 — /api/v1/auth uçları.
 *
 * Çerezler yalnız burada yazılır: tf_session (HttpOnly, SameSite=Lax,
 * üretimde Secure) + tf_csrf (JS okur, çift-gönderim). Oturum iptali
 * (logout/revoke) veritabanı kaydıyla anında etkilidir.
 */
const LogoutBodySchema = z
  .object({ refreshToken: z.string().min(20).max(200).optional() })
  .default({});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly scoped: TenantScopedPrismaService,
  ) {}

  @Post('signup')
  @UseGuards(RateLimitGuard)
  async signup(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = SignupRequestSchema.parse(body);
    const result = await this.auth.signup(input, requestMeta(req));

    setSessionCookies(
      res,
      result.session.token,
      result.session.csrfToken,
      result.session.expiresAt,
    );

    const permissions = await this.prisma.rolePermission.findMany({
      where: { roleId: result.membership.roleId },
      select: { permissionKey: true },
    });

    return {
      user: toAuthUser(result.user),
      membership: {
        membershipId: result.membership.id,
        tenantId: result.tenant.id,
        tenantName: result.tenant.name,
        tenantSlug: result.tenant.slug,
        roleKey: 'owner',
        roleName: 'Firma Sahibi',
        branchScope: result.membership.branchScope,
        status: 'ACTIVE',
      },
      permissions: permissions.map((p) => p.permissionKey),
      csrfToken: result.session.csrfToken,
    };
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = LoginRequestSchema.parse(body);
    const result = await this.auth.login(input, requestMeta(req));

    if (result.kind === 'selection') {
      return LoginSelectionResponseSchema.parse({
        selectionRequired: true,
        workspaces: result.workspaces,
      });
    }

    if (result.kind === 'web') {
      setSessionCookies(
        res,
        result.session.token,
        result.session.csrfToken,
        result.session.expiresAt,
      );
      return {
        user: toAuthUser(result.user),
        membership: toMembershipView(result.membership),
        permissions: result.permissions.map((p) => p.permissionKey),
        csrfToken: result.session.csrfToken,
      };
    }

    if (result.kind === 'mobile') {
      return {
        user: toAuthUser(result.user),
        membership: toMembershipView(result.membership),
        permissions: result.permissions.map((p) => p.permissionKey),
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
        refreshToken: result.refresh.token,
        refreshTokenExpiresAt: result.refresh.expiresAt.toISOString(),
      };
    }

    if (result.kind === 'platform-web') {
      // Platform admin (web): kiracı bağlamı yok — MFA zorunluluğu login'de denetlendi.
      setSessionCookies(
        res,
        result.session.token,
        result.session.csrfToken,
        result.session.expiresAt,
      );
      return {
        user: toAuthUser(result.user),
        platformAdmin: true,
        csrfToken: result.session.csrfToken,
      };
    }

    // Kalan tek tür: platform-mobile (üyeliksiz access token).
    return {
      user: toAuthUser(result.user),
      platformAdmin: true,
      accessToken: result.accessToken,
    };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = LogoutBodySchema.safeParse(body ?? {});
    if (ctx.kind === 'web' && ctx.sessionId) {
      await this.sessions.revokeSession(ctx.sessionId, 'logout');
    }
    if (ctx.kind === 'mobile' && parsed.success && parsed.data.refreshToken) {
      await this.sessions.revokeRefreshToken(parsed.data.refreshToken);
    }
    clearSessionCookies(res);
    await this.audit.log({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'auth.logout',
      resourceType: 'session',
      resourceId: ctx.sessionId,
      ...requestMeta(req),
    });
    // 204: passthrough res'te dönüş değeri yerine status yeterli.
    res.status(204);
    return;
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentAuth() ctx: RequestAuthContext) {
    return {
      user: {
        userId: ctx.userId,
        email: ctx.email,
        displayName: ctx.displayName,
        platformAdmin: ctx.platformAdmin,
      },
      ...(ctx.tenantId && ctx.membershipId
        ? {
            membership: {
              membershipId: ctx.membershipId,
              tenantId: ctx.tenantId,
              tenantName: ctx.tenantName,
              tenantSlug: ctx.tenantSlug,
              roleKey: ctx.roleKey,
              roleName: ctx.roleName,
              branchScope: ctx.branchScope ?? 'ALL',
              status: 'ACTIVE',
            },
          }
        : {}),
      permissions: [...ctx.permissions],
    };
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  async refresh(@Body() body: unknown, @Req() req: Request) {
    const input = RefreshRequestSchema.parse(body);
    const rotated = await this.sessions.rotateRefreshToken(input.refreshToken);

    if (!rotated.ok) {
      if (rotated.reason === 'REUSE') {
        // Token ailesi çalınmış olabilir — güvenlik olayı audit'e girer.
        await this.audit.log({
          actorType: 'system',
          action: 'auth.refresh_reuse_detected',
          resourceType: 'refresh_token_family',
          resourceId: rotated.familyId,
          ...requestMeta(req),
        });
      }
      throw new UnauthorizedException({
        message: 'Oturum yenilenemedi — yeniden giriş yapın',
        code: 'AUTH_INVALID',
      });
    }

    // Üyelik hâlâ etkin mi? (rotasyon sırasında askıya alınmış olabilir)
    // — memberships RLS'li; kimlik çözümlemesi platform kapsamında.
    const membership = await this.scoped.withPlatformAdmin((tx) =>
      tx.membership.findUnique({
        where: { id: rotated.membershipId },
        include: { role: true, tenant: true },
      }),
    );
    if (!membership || membership.status !== 'ACTIVE' || membership.tenant.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        message: 'Oturum yenilenemedi — yeniden giriş yapın',
        code: 'AUTH_INVALID',
      });
    }

    const env = getEnv();
    const accessToken = this.jwt.signAccessToken(
      {
        sub: rotated.userId,
        mid: rotated.membershipId,
        tid: membership.tenantId,
        role: membership.role.key,
      },
      env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    );
    return {
      accessToken,
      accessTokenExpiresAt: new Date(
        Date.now() + env.AUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
      refreshToken: rotated.token,
      refreshTokenExpiresAt: rotated.expiresAt.toISOString(),
    };
  }

  @Get('sessions')
  @UseGuards(AuthGuard)
  async listSessions(@CurrentAuth() ctx: RequestAuthContext) {
    return { data: await this.sessions.listUserSessions(ctx.userId, ctx.sessionId) };
  }

  @Delete('sessions/:id')
  @UseGuards(AuthGuard)
  async revokeSession(
    @Param('id') id: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    // Yalnız KENDİ oturumu iptal edebilir (IDOR yok).
    const own = await this.prisma.session.findFirst({ where: { id, userId: ctx.userId } });
    if (!own) {
      throw new NotFoundException({ message: 'Oturum bulunamadı', code: 'NOT_FOUND' });
    }
    await this.sessions.revokeSession(id, 'user_revoked');
    await this.audit.log({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'auth.session_revoked',
      resourceType: 'session',
      resourceId: id,
      ...requestMeta(req),
    });
    return { revoked: true };
  }

  @Post('sessions/revoke-all')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async revokeAll(
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const revoked = await this.sessions.revokeAllWebSessions(ctx.userId);
    clearSessionCookies(res);
    await this.audit.log({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'auth.sessions_revoked_all',
      resourceType: 'session',
      resourceId: ctx.userId,
      ...requestMeta(req),
      metadata: { revoked },
    });
    return { revoked };
  }
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function requestMeta(req: Request) {
  return {
    ip: req.ip,
    userAgent: headerString(req.headers['user-agent']),
    requestId: headerString(req.headers['x-request-id']),
  };
}

function headerString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toAuthUser(user: {
  id: string;
  emailNormalized: string;
  displayName: string;
  platformAdmin: boolean;
}) {
  return {
    userId: user.id,
    email: user.emailNormalized,
    displayName: user.displayName,
    platformAdmin: user.platformAdmin,
  };
}

function toMembershipView(m: {
  id: string;
  tenantId: string;
  branchScope: unknown;
  role: { key: string; name: string };
  tenant: { name: string; slug: string };
}) {
  return {
    membershipId: m.id,
    tenantId: m.tenantId,
    tenantName: m.tenant.name,
    tenantSlug: m.tenant.slug,
    roleKey: m.role.key,
    roleName: m.role.name,
    branchScope: m.branchScope ?? 'ALL',
    status: 'ACTIVE',
  };
}

function setSessionCookies(res: Response, token: string, csrfToken: string, expiresAt: Date): void {
  const env = getEnv();
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const base = {
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
  };
  res.cookie('tf_session', token, { ...base, httpOnly: true, maxAge });
  res.cookie('tf_csrf', csrfToken, { ...base, maxAge });
}

function clearSessionCookies(res: Response): void {
  const env = getEnv();
  const base = {
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
  };
  res.clearCookie('tf_session', { ...base, httpOnly: true });
  res.clearCookie('tf_csrf', base);
}
