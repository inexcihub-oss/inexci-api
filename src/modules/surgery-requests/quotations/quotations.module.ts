import { Module } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { QuotationsController } from './quotations.controller';
import { ChatsModule } from '../chats/chats.module';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from 'src/shared/email/email.service';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';

@Module({
  imports: [ChatsModule],
  controllers: [QuotationsController],
  providers: [
    QuotationsService,
    SurgeryRequestAccessValidator,
    JwtService,
    EmailService,
  ],
})
export class QuotationsModule {}
