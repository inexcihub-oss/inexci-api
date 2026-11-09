import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional } from 'class-validator';

export const INACTIVE_DAYS_OPTIONS = [7, 15, 30] as const;

export class AdminUsageQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Início do período (padrão: 30 dias antes de "to")',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Fim exclusivo do período (padrão: agora)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class AdminUsageInactiveQueryDto {
  @ApiPropertyOptional({
    enum: INACTIVE_DAYS_OPTIONS,
    default: 7,
    description: 'Dias sem acesso: 7, 15 ou 30',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(INACTIVE_DAYS_OPTIONS)
  days?: number;
}
