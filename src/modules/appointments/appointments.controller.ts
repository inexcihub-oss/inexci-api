import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { FindAppointmentsDto } from './dto/find-appointments.dto';
import { CreateAppointmentCommentDto } from './dto/create-appointment-comment.dto';

@ApiTags('Consultas')
@ApiBearerAuth()
@Controller('appointments')
@RequirePermission(Permission.AGENDA)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar consultas da agenda por intervalo de data' })
  @RequirePermission(Permission.AGENDA, Permission.ATENDIMENTO)
  findAgenda(
    @Query() query: FindAppointmentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.findAgenda(query, user.userId);
  }

  @Get('patient/:patientId')
  @ApiOperation({ summary: 'Histórico de consultas de um paciente' })
  @RequirePermission(Permission.AGENDA, Permission.ATENDIMENTO)
  findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.findByPatient(patientId, user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar consulta por ID' })
  @RequirePermission(Permission.AGENDA, Permission.ATENDIMENTO)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.findOneComFicha(id, user.userId);
  }

  @Get(':id/activities')
  @ApiOperation({ summary: 'Histórico da consulta (linha do tempo)' })
  @RequirePermission(Permission.AGENDA, Permission.ATENDIMENTO)
  findActivities(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.findActivities(id, user.userId);
  }

  @Post(':id/activities')
  @ApiOperation({ summary: 'Comentar no histórico da consulta' })
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: CreateAppointmentCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.addComment(id, data.content, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Agendar consulta' })
  create(
    @Body() data: CreateAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar/reagendar consulta' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.update(id, data, user.userId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Alterar status da consulta' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateAppointmentStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.updateStatus(id, data, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir consulta' })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.delete(id, user.userId);
  }
}
