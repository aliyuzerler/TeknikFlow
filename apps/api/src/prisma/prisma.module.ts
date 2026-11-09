import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';

@Global()
@Module({
  providers: [PrismaService, TenantScopedPrismaService],
  exports: [PrismaService, TenantScopedPrismaService],
})
export class PrismaModule {}
