import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** Opcional, mas sem aceitar `null` (ausente passa; `null` é recusado). */
const SeInformado = () => ValidateIf((_, v: unknown) => v !== undefined);

export class CreateClinicRoomDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da sala.' })
  @MaxLength(80)
  name: string;
}

export class UpdateClinicRoomDto {
  @SeInformado()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da sala.' })
  @MaxLength(80)
  name?: string;

  /** Sala desativada some do agendamento, mas continua nas consultas antigas. */
  @SeInformado()
  @IsBoolean()
  active?: boolean;
}
