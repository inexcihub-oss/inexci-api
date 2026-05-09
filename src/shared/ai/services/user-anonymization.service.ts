import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import { WhatsappConversationMessageRepository } from '../../../database/repositories/whatsapp-conversation-message.repository';
import { hashPhone } from '../../crypto/phone-hash.util';

@Injectable()
export class UserAnonymizationService {
  private readonly logger = new Logger(UserAnonymizationService.name);

  constructor(
    private readonly conversationRepo: WhatsappConversationRepository,
    private readonly messageRepo: WhatsappConversationMessageRepository,
  ) {}

  @OnEvent('user.deleted')
  async onUserDeleted(payload: { userId: string }): Promise<void> {
    await this.anonymizeUserData(payload);
  }

  async anonymizeUserData(payload: { userId: string }): Promise<void> {
    const { userId } = payload;
    this.logger.log(`Iniciando anonimização de dados para user=${userId}`);

    try {
      const conversations = await this.conversationRepo.findMany({
        userId,
      } as any);

      for (const conv of conversations) {
        const hashed = hashPhone(conv.phone);

        await this.conversationRepo.getRepository().update(conv.id, {
          phone: hashed,
          active: false,
        } as any);

        const messages = await this.messageRepo.findRecentByConversation(
          conv.id,
          10000,
        );
        for (const msg of messages) {
          await this.messageRepo.getRepository().update(msg.id, {
            content: '[ANONIMIZADO]',
            metadata: null,
          } as any);
        }
      }

      this.logger.log(
        `Anonimização concluída para user=${userId}: ${conversations.length} conversas processadas`,
      );
    } catch (error: any) {
      this.logger.error(
        `Falha na anonimização para user=${userId}: ${error?.message}`,
        error?.stack,
      );
    }
  }
}
