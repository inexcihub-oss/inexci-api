import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappConversationMessage } from '../entities/whatsapp-conversation-message.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class WhatsappConversationMessageRepository extends BaseRepository<WhatsappConversationMessage> {
  constructor(
    @InjectRepository(WhatsappConversationMessage)
    repository: Repository<WhatsappConversationMessage>,
  ) {
    super(repository);
  }

  async findRecentByConversation(
    conversationId: string,
    limit: number,
  ): Promise<WhatsappConversationMessage[]> {
    const messages = await this.repository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return messages.reverse();
  }
}
