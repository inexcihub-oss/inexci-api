import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { AppointmentType } from 'src/database/entities/appointment.entity';

const SeInformado = () => ValidateIf((_, v: unknown) => v !== undefined);

export class UpdateAppointmentDto {
  @SeInformado()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  clinicId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  roomId?: string | null;

  @SeInformado()
  @IsBoolean()
  isWalkIn?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  healthPlanId?: string | null;

  @SeInformado()
  @IsDateString()
  scheduledAt?: string;

  @SeInformado()
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
