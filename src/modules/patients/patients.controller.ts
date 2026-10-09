import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  RequireAnyArea,
  RequirePermission,
} from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { PatientsService } from './patients.service';
import { FindManyPatientDto } from './dto/find-many-patient.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { BulkDeletePatientsDto } from './dto/bulk-delete-patients.dto';
import { DiscardPatientPhotoDto } from './dto/discard-patient-photo.dto';

@ApiTags('Pacientes')
@ApiBearerAuth()
@Controller('patients')
@RequireAnyArea()
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar pacientes' })
  findAll(
    @Query() query: FindManyPatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.findAll(query, user.userId);
  }

  /**
   * Descarta uma foto enviada que não chegou a ser usada (troca/cadastro que
   * falhou). Só aceita caminho da própria conta e não referenciado por nenhum
   * paciente — ver `PatientsService.descartarFotoNaoUsada`.
   */
  @Post('photos/discard')
  @HttpCode(204)
  @ApiOperation({ summary: 'Descartar foto de paciente enviada e não usada' })
  discardPhoto(
    @Body() data: DiscardPatientPhotoDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.descartarFotoNaoUsada(data.path, user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar paciente por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.findOneWithPhoto(id, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar paciente' })
  create(
    @Body() data: CreatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.createWithPhoto(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar paciente' })
  update(
    @Param('id') id: string,
    @Body() data: UpdatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.updateWithPhoto(id, data, user.userId);
  }

  @Delete(':id')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Excluir paciente' })
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.delete(id, user.userId);
  }

  @Post('bulk-delete')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Excluir pacientes em lote' })
  bulkDelete(
    @Body() data: BulkDeletePatientsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.bulkDelete(data.ids, user.userId);
  }
}
