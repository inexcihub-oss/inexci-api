import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ADMIN_QUEUE_NAMES } from '../admin-queues.catalog';
import { AdminActionReasonDto } from '../../subscriptions/dto/admin-subscription-actions.dto';

export class AdminQueueSummaryDto {
  @ApiProperty({ enum: ADMIN_QUEUE_NAMES }) name: string;
  @ApiProperty() label: string;
  @ApiProperty() description: string;
  @ApiProperty() waiting: number;
  @ApiProperty() active: number;
  @ApiProperty() delayed: number;
  @ApiProperty() failed: number;
  @ApiProperty() paused: boolean;
}

export class AdminQueuesOverviewDto {
  @ApiProperty({ type: [AdminQueueSummaryDto] })
  queues: AdminQueueSummaryDto[];
  @ApiProperty({ type: String, format: 'date-time' })
  checkedAt: Date;
}

export class AdminFailedJobsQueryDto {
  @ApiPropertyOptional({ enum: ADMIN_QUEUE_NAMES })
  @IsOptional()
  @IsIn(ADMIN_QUEUE_NAMES as readonly string[])
  queue?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  offset?: number;
}

export class AdminFailedJobDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ADMIN_QUEUE_NAMES }) queue: string;
  @ApiProperty() queueLabel: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) ownerId: string | null;
  @ApiProperty({ type: String, nullable: true }) ownerName: string | null;
  @ApiProperty() attemptsMade: number;
  @ApiProperty({ type: Number, nullable: true }) maxAttempts: number | null;
  @ApiProperty({ type: String, nullable: true }) error: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  createdAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  failedAt: Date | null;
}

export class AdminFailedJobsResponseDto {
  @ApiProperty({ type: [AdminFailedJobDto] }) items: AdminFailedJobDto[];
  @ApiProperty() total: number;
}

export class AdminQueueJobActionDto extends AdminActionReasonDto {}

export class AdminQueueJobActionResultDto {
  @ApiProperty() auditLogId: string;
  @ApiProperty({ enum: ADMIN_QUEUE_NAMES }) queue: string;
  @ApiProperty() jobId: string;
}
