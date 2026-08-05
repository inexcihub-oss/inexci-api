import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { StorageService } from 'src/shared/storage/storage.service';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';
@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, StorageService, SurgeryRequestAccessValidator],
  exports: [DocumentsService],
})
export class DocumentsModule {}
