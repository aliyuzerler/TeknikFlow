import { Controller, Get, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import type { HealthReadyResponse } from '@teknikflow/contracts';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Canlılık: süreç ayakta mı? */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return this.health.live();
  }

  /** Hazırlık: bağımlılıklar yanıt veriyor mu? Degraded ise 503 döner. */
  @Get('ready')
  async ready(): Promise<HealthReadyResponse> {
    const report = await this.health.ready();
    if (report.status !== 'ok') {
      // 503 gövdesinde de aynı sözleşmeyi koruyoruz (status: 'degraded').
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
