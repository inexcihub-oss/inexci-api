import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ReceivableStatus } from 'src/database/entities/receivable.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { RefundReason } from 'src/database/entities/refund.entity';
import {
  IsDataCalendario,
  IsValorMonetario,
  PaginacaoDto,
  ReferenciaDto,
} from './finance-common.dto';

export const MAX_ITENS_POR_COBRANCA = 50;
export const MAX_IDS_DE_CONSULTAS = 200;

const aparar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ReceivableItemInputDto {
  @ApiProperty({ maxLength: 150, example: 'Primeira consulta - Dr. Fulano' })
  @Transform(aparar)
  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição do item' })
  @MaxLength(150)
  description: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'Profissional executante inválido' })
  executedById?: string;

  @ApiPropertyOptional({ example: '2026-10-20' })
  @IsOptional()
  @IsDataCalendario()
  executedAt?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'Consulta inválida' })
  appointmentId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 9999 })
  @IsOptional()
  @IsInt({ message: 'A quantidade deve ser um número inteiro' })
  @Min(1, { message: 'A quantidade deve ser no mínimo 1' })
  @Max(9999)
  quantity?: number;

  @ApiProperty({ example: '350.00' })
  @IsValorMonetario()
  unitAmount: string;

  @ApiPropertyOptional({ example: '0.00' })
  @IsOptional()
  @IsValorMonetario()
  discount?: string;

  @ApiPropertyOptional({ example: '0.00' })
  @IsOptional()
  @IsValorMonetario()
  surcharge?: string;
}

export class CreateReceivableDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Paciente inválido' })
  patientId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'Consulta inválida' })
  appointmentId?: string;

  @ApiPropertyOptional({ example: '2026-10-20' })
  @IsOptional()
  @IsDataCalendario()
  referenceDate?: string;

  @ApiPropertyOptional({ example: '2026-10-20' })
  @IsOptional()
  @IsDataCalendario()
  dueDate?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: ReceivableItemInputDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'Informe ao menos um item' })
  @ArrayMaxSize(MAX_ITENS_POR_COBRANCA)
  @ValidateNested({ each: true })
  @Type(() => ReceivableItemInputDto)
  items: ReceivableItemInputDto[];
}

export class CreateReceivableFromAppointmentDto {
  @ApiPropertyOptional({
    description: 'Confirma a cobrança de uma consulta de convênio',
  })
  @IsOptional()
  @IsBoolean()
  allowHealthPlan?: boolean;

  @ApiPropertyOptional({
    example: '350.00',
    description:
      'Valor da consulta. Obrigatório quando a consulta não tem valor registrado',
  })
  @IsOptional()
  @IsValorMonetario()
  unitAmount?: string;
}

export class AddReceivableItemDto {
  @ApiProperty({ type: ReceivableItemInputDto })
  @ValidateNested()
  @Type(() => ReceivableItemInputDto)
  item: ReceivableItemInputDto;
}

export class CancelReceivableDto {
  @ApiProperty({ maxLength: 500 })
  @Transform(aparar)
  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo do cancelamento' })
  @MaxLength(500)
  reason: string;
}

export class FindReceivablesDto extends PaginacaoDto {
  @ApiPropertyOptional({ enum: ReceivableStatus, enumName: 'ReceivableStatus' })
  @IsOptional()
  @IsEnum(ReceivableStatus)
  status?: ReceivableStatus;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDataCalendario()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDataCalendario()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  patientId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  executedById?: string;
}

export class FindAppointmentsFinanceStatusDto {
  @ApiProperty({
    type: String,
    description: `Ids das consultas separados por vírgula (máx. ${MAX_IDS_DE_CONSULTAS})`,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(MAX_IDS_DE_CONSULTAS, {
    message: `Informe no máximo ${MAX_IDS_DE_CONSULTAS} consultas`,
  })
  @IsUUID('all', { each: true, message: 'Consulta inválida' })
  ids: string[];
}

export class ReceivableListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: ReferenciaDto })
  patient: ReferenciaDto;

  @ApiProperty({ type: String, nullable: true })
  appointmentId: string | null;

  @ApiProperty({ example: '2026-10-20' })
  referenceDate: string;

  @ApiProperty({ type: String, nullable: true })
  dueDate: string | null;

  @ApiProperty({ example: '350.00' })
  totalAmount: string;

  @ApiProperty({ example: '0.00' })
  paidAmount: string;

  @ApiProperty({ example: '350.00' })
  balance: string;

  @ApiProperty({ enum: ReceivableStatus, enumName: 'ReceivableStatus' })
  status: ReceivableStatus;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class ReceivableItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: ReferenciaDto, nullable: true })
  executedBy: ReferenciaDto | null;

  @ApiProperty({ type: String, nullable: true })
  executedAt: string | null;

  @ApiProperty({ type: String, nullable: true })
  appointmentId: string | null;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unitAmount: string;

  @ApiProperty()
  discount: string;

  @ApiProperty()
  surcharge: string;

  @ApiProperty()
  total: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt: Date | null;
}

export class ReceivableRefundDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  amount: string;

  @ApiProperty({ enum: RefundReason, enumName: 'RefundReason' })
  reason: RefundReason;

  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: ReferenciaDto, nullable: true })
  refundedBy: ReferenciaDto | null;
}

export class ReceivablePaymentDto {
  @ApiProperty()
  id: string;

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

  @ApiProperty({ type: String, nullable: true })
  cashSessionId: string | null;

  @ApiProperty({ type: ReferenciaDto, nullable: true })
  receivedBy: ReferenciaDto | null;

  @ApiProperty({ type: String, nullable: true })
  cardBrand: string | null;

  @ApiProperty()
  installments: number;

  @ApiProperty({ type: String, nullable: true })
  nsu: string | null;

  @ApiProperty({ type: String, nullable: true })
  authorizationCode: string | null;

  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({ type: ReceivableRefundDto, isArray: true })
  refunds: ReceivableRefundDto[];
}

export class ReceivableDetailDto extends ReceivableListItemDto {
  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt: Date | null;

  @ApiProperty({ type: String, nullable: true })
  cancelReason: string | null;

  @ApiProperty({ type: ReferenciaDto, nullable: true })
  cancelledBy: ReferenciaDto | null;

  @ApiProperty({ type: ReferenciaDto, nullable: true })
  createdBy: ReferenciaDto | null;

  @ApiProperty({ type: ReceivableItemDto, isArray: true })
  items: ReceivableItemDto[];

  @ApiProperty({ type: ReceivablePaymentDto, isArray: true })
  payments: ReceivablePaymentDto[];
}

export class ReceivableListResponseDto {
  @ApiProperty({ type: ReceivableListItemDto, isArray: true })
  data: ReceivableListItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty({ example: '1200.00' })
  totalOpenAmount: string;
}

export class PatientFinanceSummaryDto {
  @ApiProperty({ example: '350.00' })
  openAmount: string;

  @ApiProperty({ type: ReceivableListItemDto, isArray: true })
  receivables: ReceivableListItemDto[];
}

export class AppointmentFinanceStatusDto {
  @ApiProperty()
  appointmentId: string;

  @ApiProperty()
  receivableId: string;

  @ApiProperty({ enum: ReceivableStatus, enumName: 'ReceivableStatus' })
  status: ReceivableStatus;
}

export class FinanceProfessionalDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ example: 'CRM' })
  council: string;

  @ApiProperty({ type: String, nullable: true, example: 'CRM 12345/SP' })
  registry: string | null;
}
