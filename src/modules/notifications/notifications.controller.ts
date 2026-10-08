import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { PatientNotificationSettingsService } from './patient-settings/patient-notification-settings.service';
import { UpdatePatientNotificationSettingsDto } from './patient-settings/update-patient-notification-settings.dto';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('Notificações')
@ApiBearerAuth()
@SkipThrottle()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly patientNotificationSettingsService: PatientNotificationSettingsService,
  ) {}

  // ============ Settings ============

  @Get('settings')
  @ApiOperation({ summary: 'Obter configurações de notificação' })
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

  // ============ Avisos ao paciente (por conta) ============

  // Configuração da conta, não do usuário: desligar um aviso vale para todos
  // os pacientes da clínica — por isso só a administração mexe.
  @Get('patient-settings')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Obter os avisos automáticos ao paciente da conta' })
  async getPatientSettings(@CurrentUser() user: AuthenticatedUser) {
    return await this.patientNotificationSettingsService.getForUser(
      user.userId,
    );
  }

  @Put('patient-settings')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({
    summary: 'Ligar/desligar os avisos automáticos ao paciente da conta',
  })
  async updatePatientSettings(
    @Body() data: UpdatePatientNotificationSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.patientNotificationSettingsService.updateForUser(
      user.userId,
      data,
    );
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

  @Put(':id/read')
  @ApiOperation({ summary: 'Marcar notificação como lida' })
  async markAsRead(
    // Coluna `uuid`: sem o pipe, um id malformado só falhava no Postgres.
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.notificationsService.deleteNotification(id, user.userId);
  }
}
