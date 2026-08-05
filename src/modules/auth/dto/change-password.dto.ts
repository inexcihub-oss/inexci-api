import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from 'src/shared/validators/strong-password.decorator';

export class changePasswordDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  /**
   * Reset token de uso único devolvido por `validateRecoveryPasswordCode`.
   * Amarra a troca de senha à validação prévia do código.
   */
  @IsString()
  @IsNotEmpty()
  resetToken: string;

  @IsString()
  @IsNotEmpty()
  @IsStrongPassword()
  password: string;
}
