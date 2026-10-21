import {
  IsBoolean,
  IsDecimal,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { AppointmentType } from 'src/database/entities/appointment.entity';
import {
  MENSAGEM_VALOR_INVALIDO,
  VALOR_NAO_NEGATIVO,
} from 'src/modules/finance/dto/service-price.dto';

export class CreateAppointmentDto {
  @IsUUID()
  @IsNotEmpty()
  patientId: string;

  @IsUUID()
  @IsNotEmpty()
  doctorId: string;

  @IsOptional()
  @IsUUID()
  clinicId?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  roomId?: string | null;

  @IsOptional()
  @IsBoolean()
  isWalkIn?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  healthPlanId?: string | null;

  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @IsDateString()
  @IsNotEmpty()
  scheduledAt: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDecimal({ decimal_digits: '0,2' }, { message: MENSAGEM_VALOR_INVALIDO })
  @Matches(VALOR_NAO_NEGATIVO, { message: MENSAGEM_VALOR_INVALIDO })
  price?: string | null;
}
