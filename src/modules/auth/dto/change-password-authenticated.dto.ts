import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from 'src/shared/validators/strong-password.decorator';

export class ChangePasswordAuthenticatedDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @IsStrongPassword()
  newPassword: string;
}
