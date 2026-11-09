import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class AdminRevenueSummaryQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'Mês no fuso America/Sao_Paulo; padrão: mês corrente',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month deve ser YYYY-MM' })
  month?: string;
}

export class AdminRevenueForecastQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 24, default: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;
}

export class AdminAccountInvoicesQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AdminInvoicesQueryDto extends AdminAccountInvoicesQueryDto {
  @ApiPropertyOptional({
    enum: ['draft', 'open', 'paid', 'void', 'uncollectible'],
  })
  @IsOptional()
  @IsIn(['draft', 'open', 'paid', 'void', 'uncollectible'])
  status?: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    description: 'Data de criação da fatura (ISO), inclusive',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Data de criação da fatura (ISO), exclusive',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
