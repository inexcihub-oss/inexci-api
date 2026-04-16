import { Module } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { QuotationsController } from './quotations.controller';
import { SurgeryRequestsModule } from '../surgery-requests.module';
import { ChatsModule } from '../chats/chats.module';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from 'src/shared/email/email.service';

@Module({
  imports: [SurgeryRequestsModule, ChatsModule],
  controllers: [QuotationsController],
  providers: [
    QuotationsService,
    JwtService,
    EmailService,
  ],
})
export class QuotationsModule {}
