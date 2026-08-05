import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty({ message: 'O token é obrigatório' })
  token: string;
}
