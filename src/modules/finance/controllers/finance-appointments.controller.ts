import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import {
  AppointmentFinanceStatusDto,
  FinanceProfessionalDto,
  FindAppointmentsFinanceStatusDto,
  PatientFinanceSummaryDto,
} from '../dto/receivable.dto';
import { ReceivablesService } from '../services/receivables.service';
import { ownerIdDe } from '../utils/owner';

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/appointments')
@RequirePermission(Permission.FINANCEIRO)
export class FinanceAppointmentsController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  @Get('status')
  @ApiOperation({ summary: 'Status de cobrança das consultas' })
  @ApiOkResponse({ type: AppointmentFinanceStatusDto, isArray: true })
  status(
    @Query() query: FindAppointmentsFinanceStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentFinanceStatusDto[]> {
    return this.receivablesService.appointmentsStatus(
      ownerIdDe(user),
      query.ids,
    );
  }
}

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/patients')
@RequirePermission(Permission.FINANCEIRO)
export class FinancePatientsController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  @Get(':patientId/summary')
  @ApiOperation({ summary: 'Resumo financeiro do paciente' })
  @ApiOkResponse({ type: PatientFinanceSummaryDto })
  summary(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PatientFinanceSummaryDto> {
    return this.receivablesService.patientSummary(ownerIdDe(user), patientId);
  }
}

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/professionals')
@RequirePermission(Permission.FINANCEIRO)
export class FinanceProfessionalsController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  @Get()
  @ApiOperation({ summary: 'Profissionais do tenant que podem executar itens' })
  @ApiOkResponse({ type: FinanceProfessionalDto, isArray: true })
  list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinanceProfessionalDto[]> {
    return this.receivablesService.professionals(ownerIdDe(user));
  }
}
