import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from '../../subscriptions/dto/admin-subscription-actions.dto';

export class RunSystemJobDto {
  @ApiProperty({ minLength: ADMIN_REASON_MIN, maxLength: ADMIN_REASON_MAX })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(ADMIN_REASON_MIN, ADMIN_REASON_MAX)
  reason: string;
}

export class SystemJobLastRunDto {
  @ApiProperty({ type: String, format: 'date-time' })
  at: Date;

  @ApiProperty({ type: String, nullable: true })
  by: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  result: Record<string, unknown> | null;
}

export class SystemJobDto {
  @ApiProperty({ enum: ['stale_requests', 'weekly_summary'] })
  key: 'stale_requests' | 'weekly_summary';

  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty() schedule: string;

  @ApiProperty({ type: SystemJobLastRunDto, nullable: true })
  lastManualRun: SystemJobLastRunDto | null;
}

export class StaleRequestsRunResultDto {
  @ApiProperty() notified: number;
}

export class WeeklySummaryRunResultDto {
  @ApiProperty() dispatched: number;
}
