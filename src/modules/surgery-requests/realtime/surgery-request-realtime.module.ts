import { Module } from '@nestjs/common';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { SurgeryRequestRealtimeService } from './surgery-request-realtime.service';
import { SurgeryRequestRealtimeListener } from './surgery-request-realtime.listener';

@Module({
  imports: [NotificationsModule],
  providers: [SurgeryRequestRealtimeService, SurgeryRequestRealtimeListener],
  exports: [SurgeryRequestRealtimeService],
})
export class SurgeryRequestRealtimeModule {}
