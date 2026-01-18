import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { SurgeryRequestsModule } from 'src/modules/surgery-requests/surgery-requests.module';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { EmailService } from '../email/email.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [SurgeryRequestsModule],
  providers: [CronService, SurgeryRequestRepository, EmailService, JwtService],
  exports: [CronService],
})
export class CronModule {}
