import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CheckPhoneDto {
  @IsString()
  @IsNotEmpty()
  // Mesma regra do `RegisterDto`: aceita mascarado ou só dígitos, desde que
  // tenha 10 ou 11 dígitos. Se divergisse, a etapa 1 aprovaria um formato que
  // o submit recusaria.
  @Matches(/^\D*(?:\d\D*){10,11}$/, {
    message: 'Informe um telefone válido com DDD (10 ou 11 dígitos)',
  })
  phone: string;
}
