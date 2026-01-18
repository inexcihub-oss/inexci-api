import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { Chat } from '../entities/chat.entity';

@Global()
@Injectable()
export class ChatRepository {
  constructor(
    @InjectRepository(Chat)
    private readonly repository: Repository<Chat>,
  ) {}

  async findOne(where: FindOptionsWhere<Chat>): Promise<Chat | null> {
    return await this.repository.findOne({ where });
  }

  async create(data: Partial<Chat>): Promise<Chat> {
    const chat = this.repository.create(data);
    return await this.repository.save(chat);
  }
}
