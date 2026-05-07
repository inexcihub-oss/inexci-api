import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { ConsentLog } from '../../database/entities/consent-log.entity';
import { ConsentLogRepository } from '../../database/repositories/consent-log.repository';
import { ConsentService } from './consent.service';
import { LegalDocumentsService } from './legal-documents.service';
import { PrivacyController } from './privacy.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, ConsentLog])],
  controllers: [PrivacyController],
  providers: [ConsentService, LegalDocumentsService, ConsentLogRepository],
  exports: [ConsentService],
})
export class PrivacyModule {}
