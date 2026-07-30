import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClinicalRecord } from 'src/database/entities/clinical-record.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { ClinicalRecordsService } from './clinical-records.service';
import { ClinicalRecordsController } from './clinical-records.controller';
import { ClinicalDocumentsController } from './documents/clinical-documents.controller';
import { ClinicalDocumentsService } from './documents/clinical-documents.service';
import { SurgicalIndicationService } from './surgical-indication/surgical-indication.service';
import { SurgeryRequestCreationModule } from 'src/modules/surgery-requests/creation/surgery-request-creation.module';
import { SurgeryRequestRealtimeModule } from 'src/modules/surgery-requests/realtime/surgery-request-realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClinicalRecord]),
    SurgeryRequestCreationModule,
    SurgeryRequestRealtimeModule,
  ],
  // Ordem importa: `clinical-records/documents` é um caminho fixo que colide
  // com o `clinical-records/:id` do controller de fichas. O Nest resolve as
  // rotas na ordem de registro, então o específico vem primeiro.
  controllers: [ClinicalDocumentsController, ClinicalRecordsController],
  providers: [
    ClinicalRecordsService,
    ClinicalDocumentsService,
    SurgicalIndicationService,
    StorageService,
  ],
  exports: [ClinicalRecordsService],
})
export class ClinicalRecordsModule {}
