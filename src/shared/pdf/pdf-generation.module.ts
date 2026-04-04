import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestActivity } from 'src/database/entities/surgery-request-activity.entity';
import { User } from 'src/database/entities/user.entity';
import { ReportSection } from 'src/database/entities/report-section.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { PdfModule } from './pdf.module';
import { PdfGenerationService } from './pdf-generation.service';
import { PdfGenerationProcessor } from './pdf-generation.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'pdf-generation',
    }),
    TypeOrmModule.forFeature([
      SurgeryRequest,
      SurgeryRequestActivity,
      User,
      ReportSection,
    ]),
    PdfModule,
  ],
  providers: [PdfGenerationService, PdfGenerationProcessor, StorageService],
  exports: [PdfGenerationService],
})
export class PdfGenerationModule {}
