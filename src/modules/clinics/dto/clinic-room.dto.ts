import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

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

  @SeInformado()
  @IsBoolean()
  active?: boolean;
}
