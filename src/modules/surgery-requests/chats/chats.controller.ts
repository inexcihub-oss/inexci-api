import { Controller, Post, Body, Request } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { CreateMessageDto } from './dto/create-message.dto';

@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('messages')
  sendMessage(@Body() data: CreateMessageDto, @Request() req) {
    return this.chatsService.sendMessage(data, req.user.userId);
  }
}
