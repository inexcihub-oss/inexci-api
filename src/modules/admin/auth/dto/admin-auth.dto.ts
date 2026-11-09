import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  MfaAnyCodeDto,
  MfaTotpCodeDto,
} from 'src/modules/auth/mfa/dto/mfa.dto';
import { IsStrongPassword } from 'src/shared/validators/strong-password.decorator';
import { NormalizeEmail } from 'src/shared/validators/normalize-email.decorator';

export class AdminLoginDto {
  @ApiProperty({ example: 'admin@inexci.com' })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(160)
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}

export class AdminSetupTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  setupToken: string;
}

export class AdminEnableMfaDto extends MfaTotpCodeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  setupToken: string;
}

export class AdminLoginMfaDto extends MfaAnyCodeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  mfaToken: string;
}

export class AdminRecoveryCodesDto extends MfaTotpCodeDto {}

export class AdminAcceptInviteDto {
  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(160)
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  @ApiProperty()
  @IsString()
  @IsStrongPassword()
  password: string;
}

export class AdminProfileDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty() mfaEnabled: boolean;
}

export class AdminLoginStepDto {
  @ApiProperty({ enum: ['mfa', 'mfa_setup'] })
  step: 'mfa' | 'mfa_setup';

  @ApiProperty({ required: false })
  mfaToken?: string;

  @ApiProperty({ required: false })
  setupToken?: string;
}

export class AdminMfaSetupDto {
  @ApiProperty() secret: string;
  @ApiProperty() formattedSecret: string;
  @ApiProperty() otpauthUri: string;
}

export class AdminSessionDto {
  @ApiProperty() accessToken: string;
  @ApiProperty({ type: AdminProfileDto }) admin: AdminProfileDto;
}

export class AdminSessionWithRecoveryDto extends AdminSessionDto {
  @ApiProperty({ type: [String] }) recoveryCodes: string[];
}

export class AdminRecoveryCodesResultDto {
  @ApiProperty({ type: [String] }) recoveryCodes: string[];
}
