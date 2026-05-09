import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiTokenUsageLog } from '../../database/entities/ai-token-usage-log.entity';
import { NotificationSendLog } from '../../database/entities/notification-send-log.entity';
import { AdminController } from './admin.controller';
import { AiUsageService } from './ai-usage.service';
import { NotificationLogsService } from './notification-logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiTokenUsageLog, NotificationSendLog])],
  controllers: [AdminController],
  providers: [AiUsageService, NotificationLogsService],
})
export class AdminModule {}
