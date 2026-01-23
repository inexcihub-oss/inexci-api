import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { StorageService } from 'src/shared/storage/storage.service';
import { DocumentRepository } from 'src/database/repositories/document.repository';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, StorageService, DocumentRepository],
  exports: [DocumentsService],
})
export class DocumentsModule {}
