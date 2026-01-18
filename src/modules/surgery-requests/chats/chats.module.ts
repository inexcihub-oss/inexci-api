import { Module } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { ChatRepository } from 'src/database/repositories/chat.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { ChatMessageRepository } from 'src/database/repositories/chat-message.repository';

@Module({
  controllers: [ChatsController],
  providers: [
    ChatsService,
    ChatRepository,
    UserRepository,
    ChatMessageRepository,
  ],
  exports: [ChatsService],
})
export class ChatsModule {}
