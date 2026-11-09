import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { UnauthorizedException } from '@nestjs/common';
import type { RequestAuthContext } from './auth-context.js';

/**
 * Rota izin gereksinimleri — PermissionsGuard tarafından tüketilir.
 *
 * mode 'all' (varsayılan): listedeki izinlerin TAMAMI gerekir.
 * mode 'any': izinlerden EN AZ BİRİ yeter (ör. müşteri listesi:
 *   customers:view_all VEYA customers:view_limited).
 */
export interface PermissionRequirement {
  permissions: string[];
  mode: 'all' | 'any';
}

export const PERMISSIONS_KEY = 'tf:requiredPermissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, { permissions, mode: 'all' } satisfies PermissionRequirement);
export const RequireAnyPermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, { permissions, mode: 'any' } satisfies PermissionRequirement);

/** req.auth bağlamını parametreye bağlar (oturum açılmamışsa 401). */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request & { auth?: RequestAuthContext }>();
  if (!request.auth) {
    throw new UnauthorizedException({ message: 'Oturum gerekli', code: 'AUTH_REQUIRED' });
  }
  return request.auth;
});
