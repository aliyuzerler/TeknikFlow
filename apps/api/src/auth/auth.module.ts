import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { JwtService } from './token.service.js';
import { AuthGuard } from './auth.guard.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    AuthGuard,
    RateLimitGuard,
    // JwtService argsız örneklenir (gizli anahtar getEnv'den); birim
    // testler farklı anahtarla doğrudan örneklenebilir.
    { provide: JwtService, useFactory: (): JwtService => new JwtService() },
  ],
  exports: [PasswordService, SessionService, JwtService, AuthGuard, RateLimitGuard],
})
export class AuthModule {}
