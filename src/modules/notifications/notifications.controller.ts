import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ============ Settings ============

  @Get('settings')
  async getSettings(@CurrentUser() user: AuthenticatedUser) {
    return await this.notificationsService.getSettings(user.userId);
  }

  @Put('settings')
  async updateSettings(
    @Body() data: UpdateNotificationSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.notificationsService.updateSettings(
      user.userId,
      data,
    );
  }

  // ============ Notifications ============

  @Get()
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
  async getUnreadCount(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.notificationsService.getUnreadCount(
      user.userId,
    );
    return { count };
  }

  @Put(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.notificationsService.markAsRead(id, user.userId);
  }

  @Put('read-all')
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    return await this.notificationsService.markAllAsRead(user.userId);
  }

  @Delete(':id')
  async deleteNotification(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.notificationsService.deleteNotification(
      id,
      user.userId,
    );
  }
}
