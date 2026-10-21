import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MAX_INSTALLMENTS_LIMIT,
  PaymentMethod,
} from 'src/database/entities/payment-method-config.entity';
import { RefundReason } from 'src/database/entities/refund.entity';
import {
  IsDataCalendario,
  IsValorMonetario,
  PaginacaoDto,
  ReferenciaDto,
} from './finance-common.dto';

export const MAX_LINHAS_POR_PAGAMENTO = 10;

const aparar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PaymentLineDto {
  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  @IsEnum(PaymentMethod, { message: 'Forma de pagamento inválida' })
  method: PaymentMethod;

  @ApiProperty({ example: '175.00' })
  @IsValorMonetario()
  amount: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'Conta de destino inválida' })
  accountId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_INSTALLMENTS_LIMIT })
  @IsOptional()
  @IsInt({ message: 'O número de parcelas deve ser inteiro' })
  @Min(1, { message: 'O número de parcelas deve ser no mínimo 1' })
  @Max(MAX_INSTALLMENTS_LIMIT, {
    message: `O número de parcelas deve ser no máximo ${MAX_INSTALLMENTS_LIMIT}`,
  })
  installments?: number;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(30)
  cardBrand?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(40)
  nsu?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(40)
  authorizationCode?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RegisterPaymentDto {
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Data do pagamento inválida' })
  paidAt?: string;

  @ApiProperty({ type: PaymentLineDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'Informe ao menos uma forma de pagamento' })
  @ArrayMaxSize(MAX_LINHAS_POR_PAGAMENTO)
  @ValidateNested({ each: true })
  @Type(() => PaymentLineDto)
  lines: PaymentLineDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Chave gerada pelo cliente a cada abertura do formulário. A repetição devolve o registro já feito',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Chave de idempotência inválida' })
  idempotencyKey?: string;
}

export class CreateRefundDto {
  @ApiProperty({ example: '50.00' })
  @IsValorMonetario()
  amount: string;

  @ApiProperty({ enum: RefundReason, enumName: 'RefundReason' })
  @IsEnum(RefundReason, { message: 'Motivo do estorno inválido' })
  reason: RefundReason;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  notes?: string;
}

export class FindPaymentsDto extends PaginacaoDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDataCalendario()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDataCalendario()
  to?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  accountId?: string;
}

export class PaymentListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  receivableId: string;

  @ApiProperty({ type: ReferenciaDto })
  patient: ReferenciaDto;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method: PaymentMethod;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  refundedAmount: string;

  @ApiProperty({ type: String, format: 'date-time' })
  paidAt: Date;

  @ApiProperty({ type: ReferenciaDto, nullable: true })
  account: ReferenciaDto | null;

  @ApiProperty({ type: ReferenciaDto, nullable: true })
  receivedBy: ReferenciaDto | null;

  @ApiProperty()
  installments: number;

  @ApiProperty({ type: String, nullable: true })
  cardBrand: string | null;
}

export class PaymentListResponseDto {
  @ApiProperty({ type: PaymentListItemDto, isArray: true })
  data: PaymentListItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalAmount: string;

  @ApiProperty()
  totalRefunded: string;
}
