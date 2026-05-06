import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { PendencyValidatorService } from './pendency-validator.service';

@Controller('surgery-requests/pendencies')
export class PendenciesController {
  constructor(
    private readonly pendencyValidatorService: PendencyValidatorService,
  ) {}

  /**
   * Resumo em lote para múltiplas solicitações (para Kanban)
   * GET /surgery-requests/pendencies/batch-summary?ids=id1,id2,id3
   */
  @Get('batch-summary')
  getBatchSummary(
    @Query('ids') ids: string,
  ): Promise<
    Record<string, { pending: number; total: number; canAdvance: boolean }>
  > {
    return this.pendencyValidatorService.getBatchSummary(ids);
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
