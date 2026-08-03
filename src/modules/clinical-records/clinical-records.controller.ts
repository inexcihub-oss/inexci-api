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
import { ClinicalRecordsService } from './clinical-records.service';
import { CreateClinicalRecordDto } from './dto/create-clinical-record.dto';
import { UpdateClinicalRecordDto } from './dto/update-clinical-record.dto';

@ApiTags('Prontuário')
@ApiBearerAuth()
@Controller('clinical-records')
@RequirePermission(Permission.ATENDIMENTO)
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

  /**
   * `:id` é validado como UUID em todas as rotas: sem isso, um segmento fixo
   * de outro controller (`clinical-records/documents`) chega ao banco como id
   * e devolve 500 em vez de 404/400.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Buscar atendimento por ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateClinicalRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicalRecordsService.update(id, data, user.userId);
  }

  @Post(':id/finalize')
  @ApiOperation({ summary: 'Finalizar atendimento (torna imutável)' })
  finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicalRecordsService.finalize(id, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir atendimento (se não finalizado)' })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinicalRecordsService.delete(id, user.userId);
  }
}
