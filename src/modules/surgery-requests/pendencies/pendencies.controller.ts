import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
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
  async getBatchSummary(
    @Query('ids') ids: string,
  ): Promise<
    Record<string, { pending: number; total: number; canAdvance: boolean }>
  > {
    const idArray = ids
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const summaries = await Promise.all(
      idArray.map(async (id) => {
        try {
          const result = await this.pendencyValidatorService.getSummary(id);
          return { id, ...result };
        } catch {
          return { id, pending: 0, total: 0, canAdvance: true, items: [] };
        }
      }),
    );

    return summaries.reduce(
      (acc, { id, ...summary }) => {
        acc[id] = {
          pending: summary.pending,
          total: summary.total,
          canAdvance: summary.canAdvance,
        };
        return acc;
      },
      {} as Record<
        string,
        { pending: number; total: number; canAdvance: boolean }
      >,
    );
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
