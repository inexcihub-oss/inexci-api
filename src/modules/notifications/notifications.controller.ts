import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ============ Settings ============

  @Get('settings')
  async getSettings(@Request() req: any) {
    return await this.notificationsService.getSettings(req.user.userId);
  }

  @Put('settings')
  async updateSettings(
    @Body() data: UpdateNotificationSettingsDto,
    @Request() req: any,
  ) {
    return await this.notificationsService.updateSettings(
      req.user.userId,
      data,
    );
  }

  // ============ Notifications ============

  @Get()
  async getNotifications(
    @Request() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return await this.notificationsService.getNotifications(req.user.userId, {
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any) {
    const count = await this.notificationsService.getUnreadCount(
      req.user.userId,
    );
    return { count };
  }

  @Put(':id/read')
  async markAsRead(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return await this.notificationsService.markAsRead(id, req.user.userId);
  }

  @Put('read-all')
  async markAllAsRead(@Request() req: any) {
    return await this.notificationsService.markAllAsRead(req.user.userId);
  }

  @Delete(':id')
  async deleteNotification(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return await this.notificationsService.deleteNotification(
      id,
      req.user.userId,
    );
  }
}
