import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [ReportsController],
  providers: [ReportsService, SurgeryRequestRepository],
})
export class ReportsModule {}
