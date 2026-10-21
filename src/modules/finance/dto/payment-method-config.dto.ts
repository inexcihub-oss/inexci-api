import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MAX_INSTALLMENTS_LIMIT,
  PaymentMethod,
} from 'src/database/entities/payment-method-config.entity';

export class AccountReferenceDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class PaymentMethodConfigDto {
  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method: PaymentMethod;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: String, nullable: true })
  defaultAccountId: string | null;

  @ApiProperty({ type: AccountReferenceDto, nullable: true })
  defaultAccount: AccountReferenceDto | null;

  @ApiProperty({ minimum: 1, maximum: MAX_INSTALLMENTS_LIMIT })
  maxInstallments: number;
}

export class UpdatePaymentMethodConfigDto {
  @ApiProperty()
  @IsBoolean()
  active: boolean;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @ValidateIf((_, valor) => valor !== null)
  @IsUUID('all', { message: 'Conta de destino inválida' })
  defaultAccountId: string | null;

  @ApiProperty({ minimum: 1, maximum: MAX_INSTALLMENTS_LIMIT })
  @IsInt()
  @Min(1, { message: 'O número de parcelas deve ser no mínimo 1' })
  @Max(MAX_INSTALLMENTS_LIMIT, {
    message: `O número de parcelas deve ser no máximo ${MAX_INSTALLMENTS_LIMIT}`,
  })
  maxInstallments: number;
}
