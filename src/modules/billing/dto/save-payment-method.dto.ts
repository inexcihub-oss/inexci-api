import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * Dados enviados pelo frontend após o Stripe.js ter criado o PaymentMethod.
 * O backend nunca recebe dados brutos do cartão — apenas o ID tokenizado.
 */
export class SavePaymentMethodDto {
  @ApiProperty({ example: 'pm_1ABC123' })
  @IsString()
  @IsNotEmpty()
  paymentMethodId: string;

  @ApiProperty({ example: 'MARCOS S OLIVEIRA' })
  @IsString()
  @IsNotEmpty()
  holderName: string;

  @ApiProperty({ example: 'visa' })
  @IsString()
  @IsNotEmpty()
  brand: string;

  @ApiProperty({ example: '4242' })
  @IsString()
  @Length(4, 4)
  last4: string;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  expMonth: number;

  @ApiProperty({ example: 2030 })
  @IsInt()
  @Min(2024)
  expYear: number;
}
