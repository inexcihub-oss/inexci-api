import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappConversation } from '../entities/whatsapp-conversation.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class WhatsappConversationRepository extends BaseRepository<WhatsappConversation> {
  constructor(
    @InjectRepository(WhatsappConversation)
    repository: Repository<WhatsappConversation>,
  ) {
    super(repository);
  }

  findActiveByPhone(
    phone: string,
    accountId?: string,
  ): Promise<WhatsappConversation | null> {
    const where: any = { phone, active: true };
    if (accountId) where.accountId = accountId;
    return this.repository.findOne({
      where,
      order: { lastMessageAt: 'DESC' },
    });
  }

  async deactivateOldConversations(phone: string): Promise<void> {
    await this.repository.update({ phone, active: true }, { active: false });
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .where('last_message_at < :date', { date })
      .execute();
    return result.affected ?? 0;
  }
}
