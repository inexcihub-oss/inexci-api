import { Module } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { LegalDocumentsService } from './legal-documents.service';
import { PrivacyController } from './privacy.controller';

@Module({
  controllers: [PrivacyController],
  providers: [ConsentService, LegalDocumentsService],
  exports: [ConsentService],
})
export class PrivacyModule {}
