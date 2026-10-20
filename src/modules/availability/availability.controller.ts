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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { AvailabilityService } from './availability.service';
import { DoctorSchedulesService } from './doctor-schedules.service';
import { HolidaysService } from './holidays.service';
import { ScheduleBlocksService } from './schedule-blocks.service';
import {
  CreateDoctorScheduleDto,
  UpdateDoctorScheduleDto,
} from './dto/doctor-schedule.dto';
import {
  CreateScheduleBlockDto,
  FindScheduleBlocksDto,
  UpdateScheduleBlockDto,
} from './dto/schedule-block.dto';
import {
  CreateHolidayDto,
  FindHolidaysDto,
  UpdateHolidayDto,
} from './dto/holiday.dto';
import { FindSlotsDto } from './dto/find-slots.dto';

@ApiTags('Disponibilidade da agenda')
@ApiBearerAuth()
@Controller('availability')
@RequirePermission(
  Permission.AGENDA,
  Permission.ATENDIMENTO,
  Permission.ADMINISTRACAO,
)
export class AvailabilityController {
  constructor(
    private readonly availabilityService: AvailabilityService,
    private readonly schedulesService: DoctorSchedulesService,
    private readonly blocksService: ScheduleBlocksService,
    private readonly holidaysService: HolidaysService,
  ) {}

  @Get('slots')
  @RequirePermission(Permission.AGENDA, Permission.ATENDIMENTO)
  @ApiOperation({ summary: 'Horários da grade do profissional, com ocupação' })
  slots(@Query() query: FindSlotsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.availabilityService.getSlots(query, user.userId);
  }

  @Get('schedules')
  @ApiOperation({ summary: 'Grade de atendimento do profissional' })
  schedules(
    @Query('doctorId', ParseUUIDPipe) doctorId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schedulesService.findByDoctor(
      doctorId,
      user.userId,
      user.permissions,
    );
  }

  @Post('schedules')
  @ApiOperation({ summary: 'Adicionar período à grade' })
  createSchedule(
    @Body() data: CreateDoctorScheduleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schedulesService.create(data, user.userId, user.permissions);
  }

  @Patch('schedules/:id')
  @ApiOperation({ summary: 'Alterar período da grade' })
  updateSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateDoctorScheduleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schedulesService.update(
      id,
      data,
      user.userId,
      user.permissions,
    );
  }

  @Delete('schedules/:id')
  @ApiOperation({ summary: 'Remover período da grade' })
  deleteSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schedulesService.delete(id, user.userId, user.permissions);
  }

  @Get('blocks')
  @ApiOperation({ summary: 'Bloqueios de agenda no intervalo' })
  blocks(
    @Query() query: FindScheduleBlocksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.blocksService.findInRange(query, user.userId);
  }

  @Post('blocks')
  @RequirePermission(Permission.AGENDA)
  @ApiOperation({ summary: 'Bloquear horário' })
  createBlock(
    @Body() data: CreateScheduleBlockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.blocksService.create(data, user.userId, user.permissions);
  }

  @Patch('blocks/:id')
  @RequirePermission(Permission.AGENDA)
  @ApiOperation({ summary: 'Alterar bloqueio' })
  updateBlock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateScheduleBlockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.blocksService.update(id, data, user.userId, user.permissions);
  }

  @Delete('blocks/:id')
  @RequirePermission(Permission.AGENDA)
  @ApiOperation({ summary: 'Remover bloqueio' })
  deleteBlock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.blocksService.delete(id, user.userId, user.permissions);
  }

  @Get('holidays')
  @ApiOperation({ summary: 'Feriados da conta (do ano, com os recorrentes)' })
  holidays(
    @Query() query: FindHolidaysDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.holidaysService.findMany(user.userId, query.year);
  }

  @Post('holidays')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Cadastrar feriado' })
  createHoliday(
    @Body() data: CreateHolidayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.holidaysService.create(data, user.userId);
  }

  @Patch('holidays/:id')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Alterar feriado' })
  updateHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateHolidayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.holidaysService.update(id, data, user.userId);
  }

  @Delete('holidays/:id')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Remover feriado' })
  deleteHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.holidaysService.delete(id, user.userId);
  }
}
