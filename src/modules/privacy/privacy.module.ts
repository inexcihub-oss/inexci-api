import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { ConsentService } from './consent.service';
import { LegalDocumentsService } from './legal-documents.service';
import { PrivacyController } from './privacy.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [PrivacyController],
  providers: [ConsentService, LegalDocumentsService],
  exports: [ConsentService],
})
export class PrivacyModule {}
