import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class AdminAccountDetailQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Início do período (padrão: início do mês corrente em SP)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Fim exclusivo do período (padrão: início do próximo mês)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
