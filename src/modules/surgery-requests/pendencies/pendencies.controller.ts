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
   * Requisitos ESTÁTICOS por status, direto do `pendencies.config.ts`.
   *
   * As demais rotas deste controller calculam pendências de UMA solicitação e
   * exigem o id dela. O onboarding precisa da lista antes de existir
   * solicitação alguma — e lê daqui em vez de repetir os rótulos na copy, para
   * que mudar uma pendência no config mude o tour junto.
   *
   * O `SurgeryRequestOwnerGuard` de classe não interfere: sem `:id` nem
   * `:surgeryRequestId` nos params, ele devolve `true` sem consultar nada.
   */
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
