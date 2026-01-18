import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { ChatMessage } from '../entities/chat-message.entity';

@Global()
@Injectable()
export class ChatMessageRepository {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly repository: Repository<ChatMessage>,
  ) {}

  async create(data: Partial<ChatMessage>): Promise<ChatMessage> {
    const chatMessage = this.repository.create(data);
    return await this.repository.save(chatMessage);
  }

  async updateMany(
    where: FindOptionsWhere<ChatMessage>,
    data: Partial<ChatMessage>,
  ): Promise<void> {
    await this.repository.update(where, data);
  }
}
