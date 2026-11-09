import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AdminActionReasonDto } from '../../subscriptions/dto/admin-subscription-actions.dto';

export const GATEWAY_EVENT_SITUATIONS = [
  'processed',
  'pending',
  'failed',
] as const;

export class AdminGatewayEventsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    description:
      'Só eventos com erro ou pendentes há mais de 1 hora (não processados)',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  problems?: boolean;

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

export class AdminGatewayEventDto {
  @ApiProperty() id: string;
  @ApiProperty() eventId: string;
  @ApiProperty() eventType: string;
  @ApiProperty({ type: String, nullable: true }) gatewayType: string | null;
  @ApiProperty() label: string;
  @ApiProperty({ enum: GATEWAY_EVENT_SITUATIONS })
  situation: (typeof GATEWAY_EVENT_SITUATIONS)[number];
  @ApiProperty({
    description: 'Pendente há mais de 1 hora sem ter sido processado',
  })
  stale: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  processedAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) error: string | null;
  @ApiProperty({ type: String, nullable: true }) ownerId: string | null;
  @ApiProperty({ type: String, nullable: true }) ownerName: string | null;
  @ApiProperty({ type: String, nullable: true }) customerId: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Id da assinatura que a plataforma extraiu do evento; nulo quando não identificou',
  })
  subscriptionRef: string | null;
  @ApiProperty({ type: String, nullable: true }) warning: string | null;
}

export class AdminGatewayEventCountsDto {
  @ApiProperty() failed: number;
  @ApiProperty() stalePending: number;
}

export class AdminGatewayEventsResponseDto {
  @ApiProperty({ type: [AdminGatewayEventDto] }) items: AdminGatewayEventDto[];
  @ApiProperty() total: number;
  @ApiProperty({ type: AdminGatewayEventCountsDto })
  counts: AdminGatewayEventCountsDto;
}

export class ReprocessGatewayEventDto extends AdminActionReasonDto {}

export class ReprocessGatewayEventResultDto {
  @ApiProperty() auditLogId: string;
  @ApiProperty() id: string;
  @ApiProperty({ type: String, format: 'date-time' }) processedAt: Date;
}
