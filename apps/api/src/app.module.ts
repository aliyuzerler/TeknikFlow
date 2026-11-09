import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { AuditModule } from './audit/audit.module.js';
import { EntitlementsModule } from './entitlements/entitlements.module.js';
import { PlatformModule } from './platform/platform.module.js';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    StorageModule,
    AuditModule,
    EntitlementsModule,
    AuthModule,
    RbacModule,
    TenantsModule,
    PlatformModule,
    HealthModule,
  ],
})
export class AppModule {}
