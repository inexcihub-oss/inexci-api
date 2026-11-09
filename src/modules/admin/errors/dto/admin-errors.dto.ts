import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  PLATFORM_ERROR_SOURCES,
  type PlatformErrorSource,
} from 'src/database/entities/platform-error-daily.entity';

export const ERROR_PERIOD_DAYS = [1, 7, 30, 90] as const;

export class AdminErrorsQueryDto {
  @ApiPropertyOptional({ enum: ERROR_PERIOD_DAYS, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(ERROR_PERIOD_DAYS)
  days?: number;

  @ApiPropertyOptional({ enum: PLATFORM_ERROR_SOURCES })
  @IsOptional()
  @IsIn(PLATFORM_ERROR_SOURCES)
  source?: PlatformErrorSource;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
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

export class AdminErrorOccurrencesQueryDto extends AdminErrorsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

export class AdminErrorTotalsDto {
  @ApiProperty() total: number;
  @ApiProperty() accounts: number;
  @ApiProperty() fingerprints: number;
  @ApiProperty({ description: 'Envios de e-mail/WhatsApp com falha' })
  failedDeliveries: number;
}

export class AdminErrorDayDto {
  @ApiProperty({ example: '2026-10-28' }) day: string;
  @ApiProperty({ enum: PLATFORM_ERROR_SOURCES }) source: PlatformErrorSource;
  @ApiProperty() total: number;
}

export class AdminErrorFingerprintDto {
  @ApiProperty() fingerprint: string;
  @ApiProperty({ enum: PLATFORM_ERROR_SOURCES }) source: PlatformErrorSource;
  @ApiProperty({ type: String, nullable: true }) errorClass: string | null;
  @ApiProperty({ type: String, nullable: true }) route: string | null;
  @ApiProperty({ type: String, nullable: true }) lastMessage: string | null;
  @ApiProperty() total: number;
  @ApiProperty() accounts: number;
  @ApiProperty({ type: String, format: 'date-time' }) firstSeenAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) lastSeenAt: Date;
  @ApiProperty({ type: String, nullable: true }) lastRequestId: string | null;
  @ApiProperty({ type: String, nullable: true }) exploreUrl: string | null;
}

export class AdminErrorFingerprintPageDto {
  @ApiProperty({ type: [AdminErrorFingerprintDto] })
  items: AdminErrorFingerprintDto[];
  @ApiProperty() total: number;
}

export class AdminErrorAccountDto {
  @ApiProperty() ownerId: string;
  @ApiProperty({ type: String, nullable: true }) ownerName: string | null;
  @ApiProperty() total: number;
  @ApiProperty() fingerprints: number;
  @ApiProperty({ type: String, format: 'date-time' }) lastSeenAt: Date;
}

export class AdminErrorsOverviewDto {
  @ApiProperty({ example: '2026-09-29' }) fromDay: string;
  @ApiProperty({ example: '2026-10-28' }) toDay: string;
  @ApiProperty({ type: AdminErrorTotalsDto }) totals: AdminErrorTotalsDto;
  @ApiProperty({ type: [AdminErrorDayDto] }) daily: AdminErrorDayDto[];
  @ApiProperty({ type: AdminErrorFingerprintPageDto })
  fingerprints: AdminErrorFingerprintPageDto;
  @ApiProperty({ type: [AdminErrorAccountDto] })
  accounts: AdminErrorAccountDto[];
  @ApiProperty() lokiAvailable: boolean;
}

export class AdminAccountErrorsDto {
  @ApiProperty() ownerId: string;
  @ApiProperty() fromDay: string;
  @ApiProperty() toDay: string;
  @ApiProperty({ type: AdminErrorTotalsDto }) totals: AdminErrorTotalsDto;
  @ApiProperty({ type: [AdminErrorDayDto] }) daily: AdminErrorDayDto[];
  @ApiProperty({ type: AdminErrorFingerprintPageDto })
  fingerprints: AdminErrorFingerprintPageDto;
  @ApiProperty() lokiAvailable: boolean;
}

export class AdminErrorOccurrenceDto {
  @ApiProperty() day: string;
  @ApiProperty({ type: String, nullable: true }) ownerId: string | null;
  @ApiProperty({ type: String, nullable: true }) ownerName: string | null;
  @ApiProperty() count: number;
  @ApiProperty({ type: String, format: 'date-time' }) lastSeenAt: Date;
  @ApiProperty({ type: String, nullable: true }) lastRequestId: string | null;
  @ApiProperty({ type: String, nullable: true }) lastMessage: string | null;
  @ApiProperty({ type: String, nullable: true }) route: string | null;
  @ApiProperty({ type: String, nullable: true }) exploreUrl: string | null;
}

export class AdminErrorLogLineDto {
  @ApiProperty({ type: String, format: 'date-time' }) timestamp: Date;
  @ApiProperty({ type: String, nullable: true }) level: string | null;
  @ApiProperty() message: string;
  @ApiProperty({ type: String, nullable: true }) context: string | null;
  @ApiProperty({ type: String, nullable: true }) requestId: string | null;
  @ApiProperty({ type: String, nullable: true }) traceId: string | null;
}

export class AdminErrorOccurrencesDto {
  @ApiProperty() fingerprint: string;
  @ApiProperty({ type: [AdminErrorOccurrenceDto] })
  occurrences: AdminErrorOccurrenceDto[];
  @ApiProperty({ type: [AdminErrorLogLineDto] }) logs: AdminErrorLogLineDto[];
  @ApiProperty() lokiAvailable: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['not_configured', 'unavailable'],
  })
  lokiError: 'not_configured' | 'unavailable' | null;
}
