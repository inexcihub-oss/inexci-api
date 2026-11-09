import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { NormalizeEmail } from 'src/shared/validators/normalize-email.decorator';
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from '../../subscriptions/dto/admin-subscription-actions.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePlatformAdminDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({ maxLength: 160 })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(160)
  email: string;
}

export class RevokePlatformAdminDto {
  @ApiProperty({ minLength: ADMIN_REASON_MIN, maxLength: ADMIN_REASON_MAX })
  @Transform(trim)
  @IsString()
  @Length(ADMIN_REASON_MIN, ADMIN_REASON_MAX)
  reason: string;
}

export class PlatformAdminMemberDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ description: 'Conta ativa (convite aceito e não revogada)' })
  active: boolean;
  @ApiProperty({ enum: ['pending', 'active', 'inactive'] })
  status: string;
  @ApiProperty() mfaEnabled: boolean;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastSeenAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  createdBy: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  createdById: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class ResetPlatformAdminAccessDto extends RevokePlatformAdminDto {}

export class PlatformAdminActionResultDto {
  @ApiProperty() id: string;
  @ApiProperty() auditId: string;
}
