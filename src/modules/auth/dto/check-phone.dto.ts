import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CheckPhoneDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\D*(?:\d\D*){10,11}$/, {
    message: 'Informe um telefone válido com DDD (10 ou 11 dígitos)',
  })
  phone: string;
}
