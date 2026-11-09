import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export const ADMIN_REASON_MIN = 5;
export const ADMIN_REASON_MAX = 500;
export const EXTEND_TRIAL_MAX_DAYS = 90;
export const REVOKE_TRIAL_DEFAULT_DAYS = 15;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminActionReasonDto {
  @ApiProperty({ minLength: ADMIN_REASON_MIN, maxLength: ADMIN_REASON_MAX })
  @Transform(trim)
  @IsString()
  @Length(ADMIN_REASON_MIN, ADMIN_REASON_MAX)
  reason: string;
}

export class ExtendTrialDto extends AdminActionReasonDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: EXTEND_TRIAL_MAX_DAYS,
    description: 'Dias somados a max(término atual, agora). Use days ou until.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXTEND_TRIAL_MAX_DAYS)
  days?: number;

  @ApiPropertyOptional({
    type: String,
    example: '2026-11-30',
    description:
      'Novo término (ISO 8601). Só a data vale até 23:59:59 desse dia em São Paulo. Use days ou until.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  until?: string;
}

export class GrantInternalAccessDto extends AdminActionReasonDto {}

export const REVOKE_INTERNAL_TARGETS = ['trial', 'canceled'] as const;
export type RevokeInternalTarget = (typeof REVOKE_INTERNAL_TARGETS)[number];

export class RevokeInternalAccessDto extends AdminActionReasonDto {
  @ApiProperty({ enum: REVOKE_INTERNAL_TARGETS })
  @IsIn(REVOKE_INTERNAL_TARGETS)
  to: RevokeInternalTarget;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: EXTEND_TRIAL_MAX_DAYS,
    default: REVOKE_TRIAL_DEFAULT_DAYS,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXTEND_TRIAL_MAX_DAYS)
  trialDays?: number;
}

export class AdminSubscriptionActionResultDto {
  @ApiProperty() auditLogId: string;
  @ApiProperty() status: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  trialEndsAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' })
  currentPeriodEnd: Date;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Id da assinatura na Stripe alterada, quando houve escrita lá',
  })
  gatewayRef: string | null;
}
