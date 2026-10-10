import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PendencyValidatorService } from './pendency-validator.service';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { SurgeryRequestOwnerGuard } from 'src/shared/guards/surgery-request-owner.guard';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { PENDENCIES_CONFIG } from 'src/config/pendencies.config';
import { AccessControlService } from 'src/shared/services/access-control.service';

@ApiTags('Pendências')
@ApiBearerAuth()
@UseGuards(SurgeryRequestOwnerGuard)
@Controller('surgery-requests/pendencies')
@RequirePermission(Permission.SOLICITACOES)
export class PendenciesController {
  constructor(
    private readonly pendencyValidatorService: PendencyValidatorService,
    private readonly accessControlService: AccessControlService,
  ) {}

  @Get('requirements')
  @ApiOperation({ summary: 'Requisitos estáticos por status (onboarding).' })
  getRequirements() {
    return PENDENCIES_CONFIG.map((cfg) => ({
      status: cfg.status,
      label: cfg.label,
      pendencies: cfg.pendencies.map((p) => ({
        key: p.key,
        label: p.label,
        blocking: p.blocking,
        responsibleRole: p.responsibleRole,
      })),
    }));
  }

  @Get('batch-summary')
  @ApiOperation({ summary: 'Resumo de pendências em lote (Kanban)' })
  async getBatchSummary(
    @Query('ids') ids: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<
    Record<string, { pending: number; total: number; canAdvance: boolean }>
  > {
    const doctorIds = await this.accessControlService.getAccessibleDoctorIds(
      user.userId,
    );
    return this.pendencyValidatorService.getBatchSummary(ids, doctorIds);
  }

  @Get('summary/:surgeryRequestId')
  @ApiOperation({ summary: 'Resumo de pendências' })
  getSummary(@Param('surgeryRequestId') surgeryRequestId: string) {
    return this.pendencyValidatorService.getSummary(surgeryRequestId);
  }

  @Get('validate/:surgeryRequestId')
  @ApiOperation({ summary: 'Validar pendências para avanço de status' })
  validatePendencies(@Param('surgeryRequestId') surgeryRequestId: string) {
    return this.pendencyValidatorService.validateForStatus(surgeryRequestId);
  }
}
