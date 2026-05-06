import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestActivity } from 'src/database/entities/surgery-request-activity.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { PdfModule } from './pdf.module';
import { PdfGenerationService } from './pdf-generation.service';
import { PdfGenerationProcessor } from './pdf-generation.processor';
import { SurgeryRequestPdfAssemblyService } from 'src/modules/surgery-requests/services/surgery-request-pdf-assembly.service';
import { DoctorHeaderRepository } from 'src/database/repositories/doctor-header.repository';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'pdf-generation',
    }),
    TypeOrmModule.forFeature([SurgeryRequest, SurgeryRequestActivity]),
    PdfModule,
  ],
  providers: [
    PdfGenerationService,
    PdfGenerationProcessor,
    StorageService,
    SurgeryRequestPdfAssemblyService,
    DoctorHeaderRepository,
  ],
  exports: [PdfGenerationService, SurgeryRequestPdfAssemblyService],
})
export class PdfGenerationModule {}
