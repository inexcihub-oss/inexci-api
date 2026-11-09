import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  AI_USAGE_SOURCES,
  AiUsageSource,
} from '../../../database/entities/ai-token-usage-log.entity';

export const AI_USAGE_GROUP_BY = ['user', 'owner', 'model', 'day'] as const;
export type AiUsageGroupByOption = (typeof AI_USAGE_GROUP_BY)[number];

export class AiUsageQueryDto {
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: AI_USAGE_GROUP_BY, default: 'day' })
  @IsOptional()
  @IsIn(AI_USAGE_GROUP_BY)
  groupBy?: AiUsageGroupByOption;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    enum: AI_USAGE_SOURCES,
    description: 'Sem valor, considera todas as origens',
  })
  @IsOptional()
  @IsIn(AI_USAGE_SOURCES)
  source?: AiUsageSource;
}

export class AiUsageReportRowDto {
  @ApiProperty({
    description: 'Id do usuário/conta, nome do modelo ou dia (YYYY-MM-DD)',
  })
  groupKey: string;

  @ApiProperty({ type: String, nullable: true })
  name: string | null;

  @ApiProperty({ type: String, nullable: true })
  email: string | null;

  @ApiProperty() totalPromptTokens: number;
  @ApiProperty() totalCompletionTokens: number;
  @ApiProperty() totalTokens: number;
  @ApiProperty() totalCalls: number;
  @ApiProperty({ description: 'Linhas de uso (mensagens, extrações etc.)' })
  totalRecords: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Custo estimado em centavos de dólar (US$)',
  })
  costUsdCents: number | null;

  @ApiProperty({ type: Number, nullable: true }) avgLatencyMs: number | null;
}
