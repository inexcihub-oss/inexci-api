import { Transform, Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

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
