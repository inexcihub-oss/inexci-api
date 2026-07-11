import { Transform, Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Teto definitivo de cards carregados pelo kanban numa única requisição.
 * Substitui o bug histórico do `take = 20` (que truncava silenciosamente as
 * colunas). O kanban carrega todos os cards do tenant de uma vez; a busca e os
 * filtros continuam client-side sobre este payload enxuto.
 */
export const KANBAN_MAX_TAKE = 1000;

export class FindManyKanbanDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  skip?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(KANBAN_MAX_TAKE)
  take?: number = KANBAN_MAX_TAKE;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'all' || !value) return undefined;
    return value.split(',').map((item: string) => parseInt(item));
  })
  status?: number[];
}
