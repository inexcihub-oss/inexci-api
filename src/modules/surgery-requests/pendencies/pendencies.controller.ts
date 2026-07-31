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

@ApiTags('Pendências')
@ApiBearerAuth()
@UseGuards(SurgeryRequestOwnerGuard)
@Controller('surgery-requests/pendencies')
@RequirePermission(Permission.SOLICITACOES)
export class PendenciesController {
  constructor(
    private readonly pendencyValidatorService: PendencyValidatorService,
  ) {}

  /**
   * Resumo em lote para múltiplas solicitações (para Kanban)
   * GET /surgery-requests/pendencies/batch-summary?ids=id1,id2,id3
   */
  @Get('batch-summary')
  @ApiOperation({ summary: 'Resumo de pendências em lote (Kanban)' })
  getBatchSummary(
    @Query('ids') ids: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<
    Record<string, { pending: number; total: number; canAdvance: boolean }>
  > {
    // Escopado por tenant no service — o guard não resolve id em rota de lote.
    return this.pendencyValidatorService.getBatchSummary(ids, user.ownerId);
  }

  /**
   * Resumo de pendências de uma solicitação
   * GET /surgery-requests/pendencies/summary/:id
   */
  @Get('summary/:surgeryRequestId')
  @ApiOperation({ summary: 'Resumo de pendências' })
  getSummary(@Param('surgeryRequestId') surgeryRequestId: string) {
    return this.pendencyValidatorService.getSummary(surgeryRequestId);
  }

  /**
   * Lista de pendências detalhada com flag resolved
   * GET /surgery-requests/pendencies/validate/:id
   */
  @Get('validate/:surgeryRequestId')
  @ApiOperation({ summary: 'Validar pendências para avanço de status' })
  validatePendencies(@Param('surgeryRequestId') surgeryRequestId: string) {
    return this.pendencyValidatorService.validateForStatus(surgeryRequestId);
  }
}
