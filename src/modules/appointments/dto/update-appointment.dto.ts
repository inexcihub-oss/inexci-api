import {
  IsBoolean,
  IsDecimal,
  IsDateString,
  IsEnum,
  IsInt,
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

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDecimal({ decimal_digits: '0,2' }, { message: MENSAGEM_VALOR_INVALIDO })
  @Matches(VALOR_NAO_NEGATIVO, { message: MENSAGEM_VALOR_INVALIDO })
  price?: string | null;
}
