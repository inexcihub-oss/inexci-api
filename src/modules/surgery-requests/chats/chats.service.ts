import { Injectable, NotFoundException } from '@nestjs/common';
import { ChatRepository } from 'src/database/repositories/chat.repository';
import { FindOptionsWhere } from 'typeorm';
import { CreateMessageDto } from './dto/create-message.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRole } from 'src/database/entities/user.entity';
import { ChatMessageRepository } from 'src/database/repositories/chat-message.repository';
import { Chat } from 'src/database/entities/chat.entity';

@Injectable()
export class ChatsService {
  constructor(
    private readonly chatMessageRepository: ChatMessageRepository,
    private readonly chatRepository: ChatRepository,
    private readonly userRepository: UserRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
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

    const user = await this.userRepository.findOne({ id: userId });

    if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, surgery_request: { created_by_id: userId } };
    } else if (user.role === UserRole.DOCTOR) {
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      if (doctorProfile) {
        where = { ...where, surgery_request: { doctor_id: doctorProfile.id } };
      }
    } else if (user.role === UserRole.ADMIN) {
      // Admin pode enviar para qualquer chat
    } else {
      where = { ...where, user_id: userId };
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
