import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { NotificationsHealthService } from './notifications-health.service';
import { Public } from 'src/shared/decorator/is-public.decorator';

@Controller('health/notifications')
export class NotificationsHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly notificationsHealth: NotificationsHealthService,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.notificationsHealth.checkRedis(),
      () => this.notificationsHealth.checkSmtp(),
      () => this.notificationsHealth.checkTwilio(),
    ]);
  }
}
