import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

export const ADMIN_TEAM_PERIOD_DAYS = [7, 30, 90] as const;
export type AdminTeamPeriodDays = (typeof ADMIN_TEAM_PERIOD_DAYS)[number];

export class AdminTeamQueryDto {
  @ApiPropertyOptional({
    enum: ADMIN_TEAM_PERIOD_DAYS,
    description: 'Janela da contagem de uso, em dias (padrão 30)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(ADMIN_TEAM_PERIOD_DAYS)
  days?: AdminTeamPeriodDays;
}
