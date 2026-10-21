import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import {
  IsDataCalendario,
  IsValorMonetario,
  PaginacaoDto,
  ReferenciaDto,
} from './finance-common.dto';

const aparar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class OpenCashSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Conta do caixa inválida' })
  accountId: string;

  @ApiProperty({ example: '100.00' })
  @IsValorMonetario()
  openingAmount: string;
}

export class CashMovementDto {
  @ApiProperty({ example: '50.00' })
  @IsValorMonetario()
  amount: string;

  @ApiProperty({ maxLength: 255 })
  @Transform(aparar)
  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição' })
  @MaxLength(255)
  description: string;
}

export class CloseCashSessionDto {
  @ApiProperty({ example: '250.00' })
  @IsValorMonetario()
  countedAmount: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class FindCashSessionsDto extends PaginacaoDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  userId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDataCalendario()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDataCalendario()
  to?: string;
}

export class CashSessionReportQueryDto {
  @ApiPropertyOptional({ enum: ['json', 'csv'] })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

export class TransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Conta de origem inválida' })
  fromAccountId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Conta de destino inválida' })
  toAccountId: string;

  @ApiProperty({ example: '500.00' })
  @IsValorMonetario()
  amount: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Data da transferência inválida' })
  occurredAt?: string;
}

export class TransferResultDto {
  @ApiProperty()
  outEntryId: string;

  @ApiProperty()
  inEntryId: string;
}

export class CashTotalByMethodDto {
  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method: PaymentMethod;

  @ApiProperty()
  received: string;

  @ApiProperty()
  refunded: string;

  @ApiProperty()
  net: string;
}

export class CashEntryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    enum: FinancialEntryDirection,
    enumName: 'FinancialEntryDirection',
  })
  direction: FinancialEntryDirection;

  @ApiProperty({ enum: FinancialEntryKind, enumName: 'FinancialEntryKind' })
  kind: FinancialEntryKind;

  @ApiProperty()
  amount: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: Date;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: String, nullable: true })
  paymentId: string | null;

  @ApiProperty({ type: String, nullable: true })
  refundId: string | null;
}

export class CashSessionListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: ReferenciaDto })
  user: ReferenciaDto;

  @ApiProperty({ type: ReferenciaDto })
  account: ReferenciaDto;

  @ApiProperty({ type: String, format: 'date-time' })
  openedAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  closedAt: Date | null;

  @ApiProperty()
  openingAmount: string;

  @ApiProperty({ type: String, nullable: true })
  expectedAmount: string | null;

  @ApiProperty({ type: String, nullable: true })
  countedAmount: string | null;

  @ApiProperty({ type: String, nullable: true })
  difference: string | null;
}

export class CashSessionSummaryDto extends CashSessionListItemDto {
  @ApiProperty()
  cashBalance: string;

  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({ type: ReferenciaDto, nullable: true })
  closedBy: ReferenciaDto | null;

  @ApiProperty({ type: CashTotalByMethodDto, isArray: true })
  totalsByMethod: CashTotalByMethodDto[];

  @ApiProperty({ type: CashEntryDto, isArray: true })
  entries: CashEntryDto[];
}

export class CurrentCashSessionDto {
  @ApiProperty({ type: CashSessionSummaryDto, nullable: true })
  session: CashSessionSummaryDto | null;
}

export class CashSessionListResponseDto {
  @ApiProperty({ type: CashSessionListItemDto, isArray: true })
  data: CashSessionListItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
