import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateClinicRoomDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da sala.' })
  @MaxLength(80)
  name: string;
}

export class UpdateClinicRoomDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da sala.' })
  @MaxLength(80)
  name?: string;

  /** Sala desativada some do agendamento, mas continua nas consultas antigas. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
