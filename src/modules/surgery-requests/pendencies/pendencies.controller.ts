import { Controller, Get, Param, Query } from '@nestjs/common';
import { PendencyValidatorService } from './pendency-validator.service';

@Controller('surgery-requests/pendencies')
export class PendenciesController {
  constructor(
    private readonly pendencyValidatorService: PendencyValidatorService,
  ) {}

  /**
   * Resumo em lote para múltiplas solicitações (para Kanban)
   * Exemplo: GET /surgery-requests/pendencies/batch-summary?ids=1,2,3,4,5
   */
  @Get('batch-summary')
  async getBatchSummary(
    @Query('ids') ids: string,
  ): Promise<
    Record<string, { pending: number; completed: number; total: number }>
  > {
    const idArray = ids
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const summaries = await Promise.all(
      idArray.map(async (id) => {
        try {
          const result = await this.pendencyValidatorService.validate(id);
          return {
            id,
            pending: result.pendingCount,
            completed: result.completedCount,
            total: result.totalCount,
          };
        } catch (error) {
          return { id, pending: 0, completed: 0, total: 0 };
        }
      }),
    );

    // Retornar como objeto indexado por ID
    return summaries.reduce(
      (acc, summary) => {
        acc[summary.id] = {
          pending: summary.pending,
          completed: summary.completed,
          total: summary.total,
        };
        return acc;
      },
      {} as Record<
        string,
        { pending: number; completed: number; total: number }
      >,
    );
  }

  /**
   * Validação dinâmica - calcula pendências baseadas nos dados atuais
   * Não usa tabela de pendências - tudo calculado em tempo real
   */
  @Get('validate/:surgeryRequestId')
  validatePendencies(@Param('surgeryRequestId') surgeryRequestId: string) {
    return this.pendencyValidatorService.validate(surgeryRequestId);
  }

  /**
   * Resumo rápido para Kanban
   */
  @Get('quick-summary/:surgeryRequestId')
  getQuickSummary(@Param('surgeryRequestId') surgeryRequestId: string) {
    return this.pendencyValidatorService.getQuickSummary(surgeryRequestId);
  }
}
