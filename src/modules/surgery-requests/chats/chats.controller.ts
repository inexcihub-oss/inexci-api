import { Controller, Post, Body } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { CreateMessageDto } from './dto/create-message.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('messages')
  sendMessage(
    @Body() data: CreateMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.sendMessage(data, user.userId);
  }
}
