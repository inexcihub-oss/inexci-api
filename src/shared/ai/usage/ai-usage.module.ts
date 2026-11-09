import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiTokenUsageLog } from '../../../database/entities/ai-token-usage-log.entity';
import { AiTokenUsageLogRepository } from '../../../database/repositories/ai-token-usage-log.repository';
import { AiUsageRecorder } from './ai-usage.recorder';

@Module({
  imports: [TypeOrmModule.forFeature([AiTokenUsageLog])],
  providers: [AiTokenUsageLogRepository, AiUsageRecorder],
  exports: [AiUsageRecorder],
})
export class AiUsageModule {}
