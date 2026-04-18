import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from '../entities/chat.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class ChatRepository extends BaseRepository<Chat> {
  constructor(
    @InjectRepository(Chat)
    repository: Repository<Chat>,
  ) {
    super(repository);
  }
}
