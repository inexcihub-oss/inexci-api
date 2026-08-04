import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SendRecoveryDto {
  @IsString()
  @IsNotEmpty({ message: 'O e-mail é obrigatório' })
  @IsEmail({}, { message: 'E-mail inválido' })
  email: string;
}
