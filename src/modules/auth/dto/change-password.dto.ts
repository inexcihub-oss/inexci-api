import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from 'src/shared/validators/strong-password.decorator';
import { NormalizeEmail } from 'src/shared/validators/normalize-email.decorator';

export class changePasswordDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @NormalizeEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  resetToken: string;

  @IsString()
  @IsNotEmpty()
  @IsStrongPassword()
  password: string;
}
