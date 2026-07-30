import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClinicalRecord } from 'src/database/entities/clinical-record.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { ClinicalRecordsService } from './clinical-records.service';
import { ClinicalRecordsController } from './clinical-records.controller';
import { ClinicalDocumentsController } from './documents/clinical-documents.controller';
import { ClinicalDocumentsService } from './documents/clinical-documents.service';
import { ClinicalDocumentGenerationService } from './documents/clinical-document-generation.service';
import { ClinicalRecordTemplatesController } from './templates/clinical-record-templates.controller';
import { ClinicalRecordTemplatesService } from './templates/clinical-record-templates.service';
import { PdfModule } from 'src/shared/pdf/pdf.module';
import { SurgicalIndicationService } from './surgical-indication/surgical-indication.service';
import { IndicationDocumentsService } from './surgical-indication/indication-documents.service';
import { IndicationDocumentsJobsService } from './surgical-indication/indication-documents-jobs.service';
import { IndicationDocumentsProcessor } from './surgical-indication/indication-documents.processor';
import { QueuesModule } from 'src/shared/queues/queues.module';
import { SurgeryRequestCreationModule } from 'src/modules/surgery-requests/creation/surgery-request-creation.module';
import { SurgeryRequestRealtimeModule } from 'src/modules/surgery-requests/realtime/surgery-request-realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClinicalRecord]),
    SurgeryRequestCreationModule,
    SurgeryRequestRealtimeModule,
    PdfModule,
    QueuesModule,
  ],
  // Ordem importa: `clinical-records/documents` e `clinical-records/templates`
  // são caminhos fixos que colidem com o `clinical-records/:id` do controller
  // de fichas. O Nest resolve as rotas na ordem de registro, então os
  // específicos vêm primeiro.
  controllers: [
    ClinicalDocumentsController,
    ClinicalRecordTemplatesController,
    ClinicalRecordsController,
  ],
  providers: [
    ClinicalRecordsService,
    ClinicalDocumentsService,
    ClinicalDocumentGenerationService,
    ClinicalRecordTemplatesService,
    SurgicalIndicationService,
    IndicationDocumentsService,
    IndicationDocumentsJobsService,
    IndicationDocumentsProcessor,
    StorageService,
  ],
  exports: [ClinicalRecordsService],
})
export class ClinicalRecordsModule {}
