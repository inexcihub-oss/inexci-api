import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiTokenUsageLog } from '../../database/entities/ai-token-usage-log.entity';
import { AdminController } from './admin.controller';
import { AiUsageService } from './ai-usage.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiTokenUsageLog])],
  controllers: [AdminController],
  providers: [AiUsageService],
})
export class AdminModule {}
