import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Dados de cart\u00e3o + holder enviados pelo frontend para o backend
 * tokenizar via gateway.
 *
 * IMPORTANTE: o backend NUNCA persiste o n\u00famero/CVV do cart\u00e3o; usa-os
 * apenas durante a chamada de tokeniza\u00e7\u00e3o e descarta em seguida.
 */
export class SavePaymentMethodDto {
  // ── Cart\u00e3o ──
  @ApiProperty({ example: '4111111111111111' })
  @IsString()
  @Matches(/^\d{13,19}$/, {
    message: 'N\u00famero do cart\u00e3o inv\u00e1lido',
  })
  number: string;

  @ApiProperty({ example: 'MARCOS S OLIVEIRA' })
  @IsString()
  @IsNotEmpty()
  holderName: string;

  @ApiProperty({ example: '12' })
  @IsString()
  @Matches(/^(0[1-9]|1[0-2])$/)
  expiryMonth: string;

  @ApiProperty({ example: '2030' })
  @IsString()
  @Matches(/^\d{4}$/)
  expiryYear: string;

  @ApiProperty({ example: '123' })
  @IsString()
  @Matches(/^\d{3,4}$/)
  ccv: string;

  // ── Holder info (obrigat\u00f3rio para anti-fraude do gateway) ──
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  holderInfoName: string;

  @ApiProperty()
  @IsEmail()
  holderInfoEmail: string;

  @ApiProperty({ example: '12345678901' })
  @IsString()
  @Matches(/^\d{11}|\d{14}$/, {
    message: 'CPF ou CNPJ inv\u00e1lido',
  })
  holderInfoCpfCnpj: string;

  @ApiProperty({ example: '01310-100' })
  @IsString()
  @Length(8, 9)
  holderInfoPostalCode: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  holderInfoAddressNumber: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  holderInfoAddressComplement?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  holderInfoPhone?: string;
}
