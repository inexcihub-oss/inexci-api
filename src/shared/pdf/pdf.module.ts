import { Module } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { DoctorPdfContextService } from './doctor-pdf-context.service';
import { StorageService } from 'src/shared/storage/storage.service';

@Module({
  providers: [PdfService, DoctorPdfContextService, StorageService],
  exports: [PdfService, DoctorPdfContextService],
})
export class PdfModule {}
