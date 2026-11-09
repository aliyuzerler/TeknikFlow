import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../auth/auth.decorators.js';
import type { RequestAuthContext } from '../auth/auth-context.js';

/**
 * Faz 03 — sunucu tarafı RBAC denetimi.
 * Rota üstündeki @RequirePermissions(...) anahtarlarının TAMAMI gerekir.
 * Yetki eksik → 403 (ui'da düğme gizlemek yetkilendirme DEĞİLDİR).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { auth?: RequestAuthContext }>();
    if (!request.auth) {
      throw new UnauthorizedException({ message: 'Oturum gerekli', code: 'AUTH_REQUIRED' });
    }
    const missing = required.filter((p) => !request.auth?.permissions.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException({
        message: 'Bu işlem için yetkiniz yok',
        code: 'FORBIDDEN',
      });
    }
    return true;
  }
}
