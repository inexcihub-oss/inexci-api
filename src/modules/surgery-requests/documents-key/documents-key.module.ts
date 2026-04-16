import { Module } from '@nestjs/common';
import { DocumentsKeyService } from './documents-key.service';
import { DocumentsKeyController } from './documents-key.controller';
@Module({
  controllers: [DocumentsKeyController],
  providers: [DocumentsKeyService],
  exports: [DocumentsKeyService],
})
export class DocumentsKeyModule {}
