import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { ChatMessage } from '../entities/chat-message.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class ChatMessageRepository extends BaseRepository<ChatMessage> {
  constructor(
    @InjectRepository(ChatMessage)
    repository: Repository<ChatMessage>,
  ) {
    super(repository);
  }

  async updateMany(
    where: FindOptionsWhere<ChatMessage>,
    data: Partial<ChatMessage>,
  ): Promise<void> {
    await this.repository.update(where, data);
  }
}
