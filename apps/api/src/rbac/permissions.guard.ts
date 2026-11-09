import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY, type PermissionRequirement } from '../auth/auth.decorators.js';
import type { RequestAuthContext } from '../auth/auth-context.js';

/**
 * Faz 03/04 — sunucu tarafı RBAC denetimi.
 * - 'all' modu: rotadaki izinlerin TAMAMI gerekli.
 * - 'any' modu: izinlerden en az biri yeterli (okuma uçları).
 * Yetki eksik → 403 (UI'da düğme gizlemek yetkilendirme DEĞİLDİR).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement || requirement.permissions.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { auth?: RequestAuthContext }>();
    if (!request.auth) {
      throw new UnauthorizedException({ message: 'Oturum gerekli', code: 'AUTH_REQUIRED' });
    }
    const { permissions, mode } = requirement;
    const has = (p: string) => request.auth?.permissions.has(p);

    const satisfied =
      mode === 'any' ? permissions.some((p) => has(p)) : permissions.every((p) => has(p));

    if (!satisfied) {
      throw new ForbiddenException({
        message: 'Bu işlem için yetkiniz yok',
        code: 'FORBIDDEN',
      });
    }
    return true;
  }
}
