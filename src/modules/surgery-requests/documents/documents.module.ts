import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { StorageService } from 'src/shared/storage/storage.service';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { PendenciesModule } from '../pendencies/pendencies.module';
import { PendenciesService } from '../pendencies/pendencies.service';
import { PendencyRepository } from 'src/database/repositories/pendency.repository';

@Module({
  imports: [PendenciesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, StorageService, DocumentRepository, PendenciesService, PendencyRepository],
  exports: [DocumentsService],
})
export class DocumentsModule {}
