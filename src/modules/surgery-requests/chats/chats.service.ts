import { Logger, Injectable, NotFoundException } from '@nestjs/common';
import { ChatRepository } from 'src/database/repositories/chat.repository';
import { FindOptionsWhere, In } from 'typeorm';
import { CreateMessageDto } from './dto/create-message.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { UserRole } from 'src/database/entities/user.entity';
import { ChatMessageRepository } from 'src/database/repositories/chat-message.repository';
import { Chat } from 'src/database/entities/chat.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);
  constructor(
    private readonly chatMessageRepository: ChatMessageRepository,
    private readonly chatRepository: ChatRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findOne(where: FindOptionsWhere<Chat>) {
    const chat = await this.chatRepository.findOne(where);

    return chat;
  }

  async create(data: CreateChatDto) {
    const created = await this.chatRepository.create({
      surgery_request_id: data.surgery_request_id,
      user_id: data.user_id,
    });

    return created;
  }

  async sendMessage(data: CreateMessageDto, userId: string) {
    let where: FindOptionsWhere<Chat> = { id: data.chat_id };

    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);

    if (doctorIds.length > 0) {
      where = { ...where, surgery_request: { doctor_id: In(doctorIds) } };
    }

    const chat = await this.chatRepository.findOne(where);
    if (!chat) throw new NotFoundException('Chat not found');

    const newMessage = await this.chatMessageRepository.create({
      chat_id: chat.id,
      sender_id: userId,
      message: data.message,
    });

    return newMessage;
  }
}
