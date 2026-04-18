import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappConversation } from '../../database/entities/whatsapp-conversation.entity';
import { SurgeryRequestActivity } from '../../database/entities/surgery-request-activity.entity';
import { WhatsappConversationRepository } from '../../database/repositories/whatsapp-conversation.repository';
import { SurgeryRequestActivityRepository } from '../../database/repositories/surgery-request-activity.repository';
import { RagModule } from '../rag/rag.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AccessControlModule } from '../services/access-control.module';
import { SurgeryRequestsModule } from '../../modules/surgery-requests/surgery-requests.module';
import { PendenciesModule } from '../../modules/surgery-requests/pendencies/pendencies.module';
import { AiOrchestratorService } from './services/ai-orchestrator.service';
import { OpenaiService } from './services/openai.service';
import { ConversationService } from './services/conversation.service';
import { ConversationCleanupService } from './services/conversation-cleanup.service';
import { ToolRegistryService } from './services/tool-registry.service';
import { ToolExecutorService } from './services/tool-executor.service';
import { AiMessageProcessor } from './ai-message.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ai-messages' }),
    TypeOrmModule.forFeature([WhatsappConversation, SurgeryRequestActivity]),
    RagModule,
    WhatsappModule,
    AccessControlModule,
    forwardRef(() => SurgeryRequestsModule),
    PendenciesModule,
  ],
  providers: [
    WhatsappConversationRepository,
    SurgeryRequestActivityRepository,
    OpenaiService,
    ConversationService,
    ConversationCleanupService,
    ToolRegistryService,
    ToolExecutorService,
    AiOrchestratorService,
    AiMessageProcessor,
  ],
  exports: [AiOrchestratorService],
})
export class AiModule {}
