import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsHealthService } from './notifications-health.service';
import { Public } from 'src/shared/decorator/is-public.decorator';

@ApiTags('Health')
@Controller('health/notifications')
export class NotificationsHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly notificationsHealth: NotificationsHealthService,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({
    summary: 'Healthcheck dos canais de notificação (Redis, SMTP, Twilio)',
  })
  check() {
    return this.health.check([
      () => this.notificationsHealth.checkRedis(),
      () => this.notificationsHealth.checkSmtp(),
      () => this.notificationsHealth.checkTwilio(),
    ]);
  }
}
