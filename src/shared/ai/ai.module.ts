import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappConversation } from '../../database/entities/whatsapp-conversation.entity';
import { WhatsappConversationMessage } from '../../database/entities/whatsapp-conversation-message.entity';
import { WhatsappConversationMessageRepository } from '../../database/repositories/whatsapp-conversation-message.repository';
import { SurgeryRequestActivity } from '../../database/entities/surgery-request-activity.entity';
import { AiPiiRedactionLog } from '../../database/entities/ai-pii-redaction-log.entity';
import { AiTokenUsageLog } from '../../database/entities/ai-token-usage-log.entity';
import { AiTokenUsageLogRepository } from '../../database/repositories/ai-token-usage-log.repository';
import { WhatsappConversationRepository } from '../../database/repositories/whatsapp-conversation.repository';
import { SurgeryRequestActivityRepository } from '../../database/repositories/surgery-request-activity.repository';
import { AiPiiRedactionLogRepository } from '../../database/repositories/ai-pii-redaction-log.repository';
import { RagModule } from '../rag/rag.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AccessControlModule } from '../services/access-control.module';
import { SurgeryRequestsModule } from '../../modules/surgery-requests/surgery-requests.module';
import { PendenciesModule } from '../../modules/surgery-requests/pendencies/pendencies.module';
import { TussModule } from '../../modules/tuss/tuss.module';
import { StorageModule } from '../storage/storage.module';
import { AiOrchestratorService } from './services/ai-orchestrator.service';
import { OpenaiService } from './services/openai.service';
import { ConversationService } from './services/conversation.service';
import { ConversationContextService } from './services/conversation-context.service';
import { ConversationCleanupService } from './services/conversation-cleanup.service';
import { ToolRegistryService } from './services/tool-registry.service';
import { ToolExecutorService } from './services/tool-executor.service';
import { PiiVaultService } from './services/pii-vault.service';
import { UserAnonymizationService } from './services/user-anonymization.service';
import { AiRedisService } from './services/ai-redis.service';
import { EntityResolverService } from './services/entity-resolver.service';
import { OperationDraftService } from './services/operation-draft.service';
import { WhatsappDocumentDispatcherService } from './services/whatsapp-document-dispatcher.service';
import { WhatsappDocumentProcessorService } from './services/whatsapp-document-processor.service';
import { AiMessageProcessor } from './ai-message.processor';
import { TranscriptionService } from './transcription/transcription.service';
import { FasterWhisperProvider } from './transcription/providers/faster-whisper.provider';
import { OpenaiWhisperProvider } from './transcription/providers/openai-whisper.provider';
import { OcrService } from './ocr/ocr.service';
import { DocumentClassifierService } from './ocr/document-classifier.service';
import { DocumentVisionFallbackService } from './ocr/document-vision-fallback.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ai-messages' }),
    TypeOrmModule.forFeature([
      WhatsappConversation,
      WhatsappConversationMessage,
      SurgeryRequestActivity,
      AiPiiRedactionLog,
      AiTokenUsageLog,
    ]),
    RagModule,
    WhatsappModule,
    AccessControlModule,
    forwardRef(() => SurgeryRequestsModule),
    PendenciesModule,
    TussModule,
    StorageModule,
  ],
  providers: [
    WhatsappConversationRepository,
    SurgeryRequestActivityRepository,
    AiPiiRedactionLogRepository,
    AiTokenUsageLogRepository,
    WhatsappConversationMessageRepository,
    OpenaiService,
    ConversationService,
    ConversationContextService,
    ConversationCleanupService,
    ToolRegistryService,
    ToolExecutorService,
    PiiVaultService,
    TranscriptionService,
    FasterWhisperProvider,
    OpenaiWhisperProvider,
    AiOrchestratorService,
    UserAnonymizationService,
    AiRedisService,
    EntityResolverService,
    OperationDraftService,
    WhatsappDocumentDispatcherService,
    WhatsappDocumentProcessorService,
    OcrService,
    DocumentClassifierService,
    DocumentVisionFallbackService,
    AiMessageProcessor,
  ],
  exports: [AiOrchestratorService],
})
export class AiModule {}
