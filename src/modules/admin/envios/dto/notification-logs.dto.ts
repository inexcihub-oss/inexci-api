import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  NotificationChannel,
  NotificationSendStatus,
} from 'src/database/entities/notification-send-log.entity';

export class NotificationLogsStatsQueryDto {
  @ApiPropertyOptional({ enum: NotificationChannel })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class NotificationLogsQueryDto extends NotificationLogsStatsQueryDto {
  @ApiPropertyOptional({ enum: NotificationSendStatus })
  @IsOptional()
  @IsEnum(NotificationSendStatus)
  status?: NotificationSendStatus;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class NotificationLogItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: NotificationChannel })
  channel: NotificationChannel;

  @ApiProperty({ enum: NotificationSendStatus })
  status: NotificationSendStatus;

  @ApiProperty({ description: 'Destinatário mascarado' })
  recipient: string;

  @ApiProperty({ type: String, nullable: true })
  template: string | null;

  @ApiProperty({ type: String, nullable: true })
  templateLabel: string | null;

  @ApiProperty({ type: String, nullable: true })
  notificationType: string | null;

  @ApiProperty({ type: String, nullable: true })
  direction: string | null;

  @ApiProperty()
  attempts: number;

  @ApiProperty({ type: String, nullable: true })
  error: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  ownerId: string | null;

  @ApiProperty({ type: String, nullable: true })
  ownerName: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sentAt: Date | null;
}

export class NotificationLogListResponseDto {
  @ApiProperty({ type: [NotificationLogItemDto] })
  items: NotificationLogItemDto[];

  @ApiProperty()
  total: number;
}

export class NotificationLogStatsRowDto {
  @ApiProperty({ enum: NotificationChannel })
  channel: NotificationChannel;

  @ApiProperty({ enum: NotificationSendStatus })
  status: NotificationSendStatus;

  @ApiProperty()
  count: number;
}
