import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { NotificationsHealthController } from './notifications-health.controller';
import { NotificationsHealthService } from './notifications-health.service';

@Module({
  imports: [TerminusModule],
  controllers: [NotificationsHealthController],
  providers: [NotificationsHealthService],
})
export class NotificationsHealthModule {}
