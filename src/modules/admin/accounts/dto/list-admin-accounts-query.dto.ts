import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AdminAccountSituation } from '../admin-account-situation';
import {
  ACCOUNT_HEALTH_BANDS,
  AccountHealthBand,
} from 'src/database/entities/account-health-daily.entity';

export enum AdminAccountSort {
  CREATED_AT = 'createdAt',
  TRIAL_ENDS_AT = 'trialEndsAt',
  LAST_SEEN_AT = 'lastSeenAt',
  MRR = 'mrr',
  HEALTH = 'health',
}

export enum AdminSortDirection {
  ASC = 'asc',
  DESC = 'desc',
}

export class ListAdminAccountsQueryDto {
  @ApiPropertyOptional({ description: 'Nome ou e-mail do dono da conta' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(160)
  search?: string;

  @ApiPropertyOptional({ enum: AdminAccountSituation })
  @IsOptional()
  @IsEnum(AdminAccountSituation)
  situation?: AdminAccountSituation;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({
    enum: ACCOUNT_HEALTH_BANDS,
    description: 'Faixa de saúde do último cálculo',
  })
  @IsOptional()
  @IsIn(ACCOUNT_HEALTH_BANDS)
  health?: AccountHealthBand;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  trialEndingInDays?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  inactiveDays?: number;

  @ApiPropertyOptional({
    enum: AdminAccountSort,
    default: AdminAccountSort.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(AdminAccountSort)
  sortBy?: AdminAccountSort;

  @ApiPropertyOptional({
    enum: AdminSortDirection,
    default: AdminSortDirection.DESC,
  })
  @IsOptional()
  @IsEnum(AdminSortDirection)
  sortDir?: AdminSortDirection;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
