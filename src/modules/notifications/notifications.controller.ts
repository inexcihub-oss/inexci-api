import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@SkipThrottle()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ============ Settings ============

  @Get('settings')
  async getSettings(@CurrentUser() user: AuthenticatedUser) {
    return await this.notificationsService.getSettings(user.userId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Atualizar configurações de notificação' })
  async updateSettings(
    @Body() data: UpdateNotificationSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.notificationsService.updateSettings(user.userId, data);
  }

  // ============ Notifications ============

  @Get()
  @ApiOperation({ summary: 'Listar notificações' })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'unreadOnly', required: false })
  async getNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return await this.notificationsService.getNotifications(user.userId, {
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Contagem de notificações não lidas' })
  async getUnreadCount(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.notificationsService.getUnreadCount(user.userId);
    return { count };
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Marcar notificação como lida' })
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.notificationsService.markAsRead(id, user.userId);
  }

  @Put('read-all')
  @ApiOperation({ summary: 'Marcar todas como lidas' })
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    return await this.notificationsService.markAllAsRead(user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir notificação' })
  async deleteNotification(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.notificationsService.deleteNotification(id, user.userId);
  }
}
