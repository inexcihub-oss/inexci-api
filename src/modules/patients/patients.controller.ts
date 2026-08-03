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
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
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

@ApiTags('Pacientes')
@ApiBearerAuth()
@Controller('patients')
// Paciente é cadastro transversal, não pertence a nenhuma área: Agenda busca
// e cria paciente ao agendar (NewAppointmentModal), Atendimento usa na
// ficha/prontuário, Solicitações usa no wizard de criação e Administração usa
// na tela de colaborador/assistente. Anotar a classe com as áreas de negócio
// quebraria alguma dessas telas; anotar as quatro seria o mesmo que não
// anotar nada. O recorte real de acesso já existe e não é por permissão de
// área: é o `ownerId` (isolamento entre clínicas). Só excluir é ato
// restrito — por isso `delete`/`bulkDelete` têm `@RequirePermission`
// individual abaixo. NÃO adicione um `@RequirePermission` de classe aqui.
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

  @Get(':id')
  @ApiOperation({ summary: 'Buscar paciente por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.findOne(id, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar paciente' })
  create(
    @Body() data: CreatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar paciente' })
  update(
    @Param('id') id: string,
    @Body() data: UpdatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.update(id, data, user.userId);
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
