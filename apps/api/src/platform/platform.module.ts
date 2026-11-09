import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
})
export class PlatformModule {}
