import { Injectable, Logger } from '@nestjs/common';
import { ConversationService } from '../conversation.service';
import { AccessControlService } from '../../../services/access-control.service';
import { PiiVaultService } from '../pii-vault.service';
import { PiiBindingService } from './pii-binding.service';
import { SimpleCache } from '../../utils/simple-cache';
import { WhatsappConversation } from '../../../../database/entities/whatsapp-conversation.entity';
import { User } from '../../../../database/entities/user.entity';

export interface SessionBootstrapResult {
  conversation: WhatsappConversation;
  accessibleDoctorIds: string[];
  ownerId: string | null;
}

/**
 * Inicializa a sessão de processamento de uma mensagem inbound:
 * carrega/cria a conversa, popula o cache de doctorIds e restaura
 * os bindings PII persistidos do turno anterior.
 *
 * Extraído de `AiOrchestratorService` para reduzir o tamanho do
 * coordenador principal e isolar a lógica de bootstrap de sessão.
 */
@Injectable()
export class SessionBootstrapService {
  private readonly logger = new Logger(SessionBootstrapService.name);
  private readonly doctorIdsCache = new SimpleCache<string[]>();

  constructor(
    private readonly conversationService: ConversationService,
    private readonly accessControlService: AccessControlService,
    private readonly piiVault: PiiVaultService,
    private readonly piiBindingService: PiiBindingService,
  ) {}

  async setup(
    phone: string,
    userId: string,
    user: User,
  ): Promise<SessionBootstrapResult> {
    const ownerId = user?.ownerId || null;

    const cachedDoctorIds = this.doctorIdsCache.get(userId);
    const accessibleDoctorIds =
      cachedDoctorIds ??
      (await this.accessControlService.getAccessibleDoctorIds(userId));
    if (!cachedDoctorIds)
      this.doctorIdsCache.set(userId, accessibleDoctorIds, 5 * 60 * 1000);

    const conversation = await this.conversationService.getOrCreateConversation(
      phone,
      userId,
      ownerId,
    );

    this.piiVault.startSession(conversation.id);
    const persistedBindings =
      await this.piiBindingService.loadPersistedPiiBindings(conversation.id);
    if (persistedBindings?.length) {
      this.piiVault.restoreSession(conversation.id, persistedBindings);
      this.logger.debug(
        `[PII_VAULT_PERSIST] restored conv=${conversation.id} count=${persistedBindings.length}`,
      );
    }

    return { conversation, accessibleDoctorIds, ownerId };
  }

  invalidateDoctorIdsCache(userId: string): void {
    this.doctorIdsCache.delete(userId);
  }
}
