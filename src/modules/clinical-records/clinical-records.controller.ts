import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { ClinicalRecordsService } from './clinical-records.service';
import { CreateClinicalRecordDto } from './dto/create-clinical-record.dto';
import { UpdateClinicalRecordDto } from './dto/update-clinical-record.dto';

@ApiTags('Prontuário')
@ApiBearerAuth()
@Controller('clinical-records')
export class ClinicalRecordsController {
  constructor(
    private readonly clinicalRecordsService: ClinicalRecordsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar atendimentos por paciente ou consulta' })
  find(
    @Query('patientId') patientId: string | undefined,
    @Query('appointmentId') appointmentId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (appointmentId) {
      return this.clinicalRecordsService.findByAppointment(
        appointmentId,
        user.userId,
      );
    }
    return this.clinicalRecordsService.findByPatient(patientId!, user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar atendimento por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clinicalRecordsService.findOne(id, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar atendimento (ficha)' })
  create(
    @Body() data: CreateClinicalRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicalRecordsService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar atendimento (se não finalizado)' })
  update(
    @Param('id') id: string,
    @Body() data: UpdateClinicalRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicalRecordsService.update(id, data, user.userId);
  }

  @Post(':id/finalize')
  @ApiOperation({ summary: 'Finalizar atendimento (torna imutável)' })
  finalize(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clinicalRecordsService.finalize(id, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir atendimento (se não finalizado)' })
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clinicalRecordsService.delete(id, user.userId);
  }
}
