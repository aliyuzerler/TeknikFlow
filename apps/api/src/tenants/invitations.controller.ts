import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AcceptInvitationRequestSchema } from '@teknikflow/contracts';
import { TenantsService } from '../tenants/tenants.service.js';
import { SessionService } from '../auth/session.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RateLimitGuard } from '../auth/rate-limit.guard.js';
import { getEnv } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';

/**
 * Faz 03 — davet uçları (oturum öncesi erişilebilir).
 *
 * /invitations/:token önizleme: bilinen token tek gerçekliktir; kiracı/rol
 * adı dışında üstveri sızmaz. Kabul: yeni kullanıcı parola kurar; mevcut
 * kullanıcı oturum açmış VE e-postası davetle eşleşen kişi olmalı.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly scoped: TenantScopedPrismaService,
  ) {}

  @Get(':token')
  async preview(@Param('token') token: string) {
    return this.tenants.previewInvitation(token);
  }

  @Post(':token/accept')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  async accept(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = AcceptInvitationRequestSchema.parse(body);

    // Mevcut kullanıcı akışı: çerez varsa kimlik çözümlenir (zorunlu değil —
    // yeni kullanıcıda çerez yoktur). Bearer da aynı şekilde ele alınır.
    let authenticatedUserId: string | undefined;
    const auth = await tryResolveAuth(req, this.prisma);
    if (auth) {
      authenticatedUserId = auth.userId;
    }

    const result = await this.tenants.acceptInvitation(
      token,
      {
        displayName: input.displayName,
        password: input.password,
        authenticatedUserId,
      },
      {
        ip: req.ip,
        userAgent: headerString(req.headers['user-agent']),
        requestId: headerString(req.headers['x-request-id']),
      },
    );

    // Yeni kullanıcı → oturum kurulur (onboarding devam eder).
    if (result.isNewUser && input.client === 'web') {
      const session = await this.sessions.createWebSession({
        userId: result.userId,
        membershipId: result.membershipId,
        ip: req.ip,
        userAgent: headerString(req.headers['user-agent']),
      });
      setSessionCookies(res, session.token, session.csrfToken, session.expiresAt);
    }

    // Kabul sonrası üyelik görünümü — platform kapsamında çözümlenir
    // (memberships RLS'li; davet kabulü kiracı bağlamı kurmadan önce biter).
    const membership = await this.scoped.withPlatformAdmin((tx) =>
      tx.membership.findUniqueOrThrow({
        where: { id: result.membershipId },
        include: { role: true, tenant: true },
      }),
    );
    const permissions = await this.prisma.rolePermission.findMany({
      where: { roleId: membership.roleId },
      select: { permissionKey: true },
    });

    return {
      user: {
        userId: result.userId,
        email: result.email,
        displayName: input.displayName ?? result.email.split('@')[0],
        platformAdmin: false,
      },
      membership: {
        membershipId: membership.id,
        tenantId: membership.tenantId,
        tenantName: membership.tenant.name,
        tenantSlug: membership.tenant.slug,
        roleKey: membership.role.key,
        roleName: membership.role.name,
        branchScope: membership.branchScope ?? 'ALL',
        status: membership.status,
      },
      permissions: permissions.map((p) => p.permissionKey),
    };
  }
}

/** Oturum öncesi uçta isteğe bağlı kimlik çözümlemesi (yardımcı). */
async function tryResolveAuth(req: Request, prisma: PrismaService) {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return null; // Mobil kabul akışı Faz 07'de token akışıyla test edilir.
  }
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string') return null;

  const { readCookie } = await import('../auth/auth.guard.js');
  const { sha256 } = await import('../auth/token.service.js');
  const token = readCookie(cookieHeader, 'tf_session');
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== 'ACTIVE') return null;
  return { userId: session.userId };
}

function headerString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
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
