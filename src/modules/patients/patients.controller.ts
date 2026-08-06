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

@ApiTags('Pacientes')
@ApiBearerAuth()
@Controller('patients')
// Paciente é cadastro transversal, não pertence a UMA área: Agenda busca e cria
// paciente ao agendar (NewAppointmentModal), Atendimento usa na ficha/prontuário,
// Solicitações usa no wizard de criação e Administração usa na tela de
// colaborador/assistente. Por isso NÃO anotamos uma área específica — mas
// também não deixamos a classe sem decorator: rota sem metadata fica liberada a
// QUALQUER autenticado, inclusive um colaborador com `permissions: []`, que
// passava a ler/criar/editar toda a base de pacientes (dado de saúde sensível,
// LGPD art. 11). `@RequireAnyArea()` exige ao menos UMA das quatro áreas: é
// transversal (qualquer usuário de qualquer área passa) e ainda assim
// fail-closed para quem não tem acesso a área nenhuma. O isolamento entre
// clínicas continua sendo o `ownerId`; excluir permanece restrito a
// `ADMINISTRACAO` via `@RequirePermission` nos métodos delete/bulkDelete.
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
