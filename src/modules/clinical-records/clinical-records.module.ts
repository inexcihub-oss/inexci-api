import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClinicalRecord } from 'src/database/entities/clinical-record.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { ClinicalRecordsService } from './clinical-records.service';
import { ClinicalRecordsController } from './clinical-records.controller';
import { ClinicalDocumentsController } from './documents/clinical-documents.controller';
import { ClinicalDocumentsService } from './documents/clinical-documents.service';

@Module({
  imports: [TypeOrmModule.forFeature([ClinicalRecord])],
  controllers: [ClinicalRecordsController, ClinicalDocumentsController],
  providers: [ClinicalRecordsService, ClinicalDocumentsService, StorageService],
  exports: [ClinicalRecordsService],
})
export class ClinicalRecordsModule {}
