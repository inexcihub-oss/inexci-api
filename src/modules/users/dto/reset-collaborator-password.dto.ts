import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from 'src/shared/validators/strong-password.decorator';

export class ResetCollaboratorPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'A senha é obrigatória' })
  @IsStrongPassword()
  password: string;
}
