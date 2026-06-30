import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AI_TOOL } from './tools/tool.interface';
import { aiToolsFactory, AI_TOOLS_INJECT } from './tools/ai-tools.module';
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
import { CidModule } from '../../modules/surgery-requests/cid/cid.module';
import { StorageModule } from '../storage/storage.module';
import { PatientsModule } from '../../modules/patients/patients.module';
import { HospitalsModule } from '../../modules/hospitals/hospitals.module';
import { HealthPlansModule } from '../../modules/health-plans/health-plans.module';
import { ProceduresModule } from '../../modules/procedures/procedures.module';
import { OpmeModule } from '../../modules/surgery-requests/opme/opme.module';
import { UsersModule } from '../../modules/users/users.module';
import { DocumentsModule } from '../../modules/surgery-requests/documents/documents.module';
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
import { DocumentExtractionService } from './ocr/document-extraction.service';
import { ResponseNormalizerService } from './services/orchestrator/response-normalizer.service';
import { PhoneNormalizerService } from './services/orchestrator/phone-normalizer.service';
import { ClearContextDetectorService } from './services/orchestrator/clear-context-detector.service';
import { ConfirmationManagerService } from './services/orchestrator/confirmation-manager.service';
import { OrchestratorTelemetryService } from './services/orchestrator/orchestrator-telemetry.service';
import { ToolLoopRunnerService } from './services/orchestrator/tool-loop-runner.service';
import { MessageProcessorService } from './services/orchestrator/message-processor.service';
import { DocumentIntakeService } from './services/orchestrator/document-intake.service';
import { AudioIntakeService } from './services/orchestrator/audio-intake.service';
import { PiiBindingService } from './services/orchestrator/pii-binding.service';
import { ConversationMemoryService } from './services/orchestrator/conversation-memory.service';
import { NextStepAdvisorService } from './services/orchestrator/next-step-advisor.service';
import { DraftContextService } from './services/orchestrator/draft-context.service';

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
    CidModule,
    StorageModule,
    PatientsModule,
    HospitalsModule,
    HealthPlansModule,
    ProceduresModule,
    OpmeModule,
    UsersModule,
    DocumentsModule,
  ],
  providers: [
    WhatsappConversationRepository,
    SurgeryRequestActivityRepository,
    AiPiiRedactionLogRepository,
    AiTokenUsageLogRepository,
    WhatsappConversationMessageRepository,
    {
      provide: AI_TOOL,
      useFactory: aiToolsFactory,
      inject: AI_TOOLS_INJECT,
    },
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
    DocumentExtractionService,
    ResponseNormalizerService,
    PhoneNormalizerService,
    ClearContextDetectorService,
    ConfirmationManagerService,
    OrchestratorTelemetryService,
    ToolLoopRunnerService,
    MessageProcessorService,
    DocumentIntakeService,
    AudioIntakeService,
    PiiBindingService,
    ConversationMemoryService,
    NextStepAdvisorService,
    DraftContextService,
    AiMessageProcessor,
  ],
  exports: [AiOrchestratorService, DocumentExtractionService],
})
export class AiModule {}
