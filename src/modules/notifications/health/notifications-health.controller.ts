import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsHealthService } from './notifications-health.service';
import { Public } from 'src/shared/decorators/is-public.decorator';
import { PlatformAdminOnly } from 'src/modules/admin/auth/platform-admin-only.decorator';

@ApiTags('Health')
@Controller('health/notifications')
export class NotificationsHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly notificationsHealth: NotificationsHealthService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Healthcheck resumido dos canais de notificação',
  })
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.executar();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error' });
    }
  }

  @Get('details')
  @PlatformAdminOnly()
  @HealthCheck()
  @ApiOperation({
    summary:
      'Healthcheck detalhado dos canais de notificação (Redis, SMTP, Twilio)',
  })
  details() {
    return this.executar();
  }

  private executar() {
    return this.health.check([
      () => this.notificationsHealth.checkRedis(),
      () => this.notificationsHealth.checkSmtp(),
      () => this.notificationsHealth.checkTwilio(),
    ]);
  }
}
