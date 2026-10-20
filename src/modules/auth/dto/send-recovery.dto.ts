import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { NormalizeEmail } from 'src/shared/validators/normalize-email.decorator';

export class SendRecoveryDto {
  @IsString()
  @IsNotEmpty({ message: 'O e-mail é obrigatório' })
  @IsEmail({}, { message: 'E-mail inválido' })
  @NormalizeEmail()
  email: string;
}
