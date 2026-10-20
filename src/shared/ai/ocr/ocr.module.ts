import { Module } from '@nestjs/common';
import { OpenaiService } from '../services/openai.service';
import { PiiVaultService } from '../services/pii-vault.service';
import { OcrService } from './ocr.service';
import { DocumentClassifierService } from './document-classifier.service';
import { DocumentVisionFallbackService } from './document-vision-fallback.service';
import { DocumentExtractionService } from './document-extraction.service';

@Module({
  providers: [
    OpenaiService,
    PiiVaultService,
    OcrService,
    DocumentClassifierService,
    DocumentVisionFallbackService,
    DocumentExtractionService,
  ],
  exports: [
    OpenaiService,
    PiiVaultService,
    OcrService,
    DocumentClassifierService,
    DocumentVisionFallbackService,
    DocumentExtractionService,
  ],
})
export class OcrModule {}
