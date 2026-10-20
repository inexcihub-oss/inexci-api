import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

const TOTP_REGEX = /^\s*\d{3}\s?\d{3}\s*$/;
const CODIGO_REGEX = /^[\sA-Za-z0-9-]{6,20}$/;

export class MfaTotpCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(TOTP_REGEX, { message: 'Informe os 6 dígitos do aplicativo.' })
  code: string;
}

export class MfaAnyCodeDto {
  @ApiProperty({
    example: '123456',
    description: 'Código TOTP de 6 dígitos ou código de recuperação',
  })
  @IsString()
  @Matches(CODIGO_REGEX, { message: 'Código inválido.' })
  code: string;
}

export class LoginMfaDto extends MfaAnyCodeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  mfaToken: string;
}

export class DisableMfaDto extends MfaAnyCodeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
