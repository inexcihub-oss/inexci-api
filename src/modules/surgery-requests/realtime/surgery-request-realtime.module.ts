import { Module } from '@nestjs/common';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { SurgeryRequestRealtimeService } from './surgery-request-realtime.service';

@Module({
  imports: [NotificationsModule],
  providers: [SurgeryRequestRealtimeService],
  exports: [SurgeryRequestRealtimeService],
})
export class SurgeryRequestRealtimeModule {}
