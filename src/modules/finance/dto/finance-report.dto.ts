import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';
import type { AgrupamentoDeRecebimentos } from 'src/database/repositories/finance-reports.repository';

export const DATA_YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const MENSAGEM_DE_DATA = 'Use uma data válida no formato AAAA-MM-DD';

export const AGRUPAMENTOS_DE_RECEBIMENTOS: readonly AgrupamentoDeRecebimentos[] =
  ['day', 'month', 'method', 'account', 'user'];

export const FORMATOS_DE_RELATORIO = ['json', 'csv'] as const;
export type FormatoDeRelatorio = (typeof FORMATOS_DE_RELATORIO)[number];

export class ReportFormatQueryDto {
  @ApiPropertyOptional({ enum: FORMATOS_DE_RELATORIO, default: 'json' })
  @IsOptional()
  @IsIn(FORMATOS_DE_RELATORIO, { message: 'Formato deve ser json ou csv' })
  format?: FormatoDeRelatorio;
}

export class ReportPeriodQueryDto extends ReportFormatQueryDto {
  @ApiProperty({
    example: '2026-10-01',
    description: 'Data inicial (AAAA-MM-DD)',
  })
  @Matches(DATA_YYYY_MM_DD, { message: MENSAGEM_DE_DATA })
  @IsDateString({ strict: true }, { message: MENSAGEM_DE_DATA })
  from: string;

  @ApiProperty({
    example: '2026-10-31',
    description: 'Data final, inclusiva (AAAA-MM-DD)',
  })
  @Matches(DATA_YYYY_MM_DD, { message: MENSAGEM_DE_DATA })
  @IsDateString({ strict: true }, { message: MENSAGEM_DE_DATA })
  to: string;
}

export class ReceiptsReportQueryDto extends ReportPeriodQueryDto {
  @ApiProperty({ enum: AGRUPAMENTOS_DE_RECEBIMENTOS })
  @IsIn(AGRUPAMENTOS_DE_RECEBIMENTOS, {
    message: 'Agrupamento deve ser day, month, method, account ou user',
  })
  groupBy: AgrupamentoDeRecebimentos;
}

export class ProductionReportQueryDto extends ReportPeriodQueryDto {}

export class OpenReportQueryDto extends ReportFormatQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-20',
    description: 'Inclui cobranças com vencimento até esta data (padrão: hoje)',
  })
  @IsOptional()
  @Matches(DATA_YYYY_MM_DD, { message: MENSAGEM_DE_DATA })
  @IsDateString({ strict: true }, { message: MENSAGEM_DE_DATA })
  until?: string;
}

export class ReceiptsReportRowDto {
  @ApiProperty({ type: String, nullable: true })
  key: string | null;

  @ApiProperty()
  label: string;

  @ApiProperty({ example: '300.00' })
  received: string;

  @ApiProperty({ example: '50.00' })
  refunded: string;

  @ApiProperty({ example: '250.00' })
  net: string;

  @ApiProperty()
  count: number;
}

export class ReceiptsReportTotalsDto {
  @ApiProperty()
  received: string;

  @ApiProperty()
  refunded: string;

  @ApiProperty()
  net: string;

  @ApiProperty()
  count: number;
}

export class ReceiptsReportDto {
  @ApiProperty({ enum: AGRUPAMENTOS_DE_RECEBIMENTOS })
  groupBy: AgrupamentoDeRecebimentos;

  @ApiProperty({ type: ReceiptsReportRowDto, isArray: true })
  rows: ReceiptsReportRowDto[];

  @ApiProperty({ type: ReceiptsReportTotalsDto })
  totals: ReceiptsReportTotalsDto;
}

export class ProductionReportRowDto {
  @ApiProperty({ type: String, nullable: true })
  executedById: string | null;

  @ApiProperty()
  name: string;

  @ApiProperty()
  items: number;

  @ApiProperty()
  billed: string;

  @ApiProperty()
  received: string;
}

export class ProductionReportTotalsDto {
  @ApiProperty()
  items: number;

  @ApiProperty()
  billed: string;

  @ApiProperty()
  received: string;
}

export class ProductionReportDto {
  @ApiProperty({ type: ProductionReportRowDto, isArray: true })
  rows: ProductionReportRowDto[];

  @ApiProperty({ type: ProductionReportTotalsDto })
  totals: ProductionReportTotalsDto;
}

export class OpenReportPatientDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class OpenReportRowDto {
  @ApiProperty()
  receivableId: string;

  @ApiProperty({ type: OpenReportPatientDto })
  patient: OpenReportPatientDto;

  @ApiProperty({ example: '2026-10-01' })
  referenceDate: string;

  @ApiProperty({ type: String, nullable: true })
  dueDate: string | null;

  @ApiProperty()
  totalAmount: string;

  @ApiProperty()
  paidAmount: string;

  @ApiProperty()
  balance: string;

  @ApiProperty()
  ageDays: number;
}

export class OpenReportTotalsDto {
  @ApiProperty()
  count: number;

  @ApiProperty()
  balance: string;
}

export class OpenReportDto {
  @ApiProperty({ type: OpenReportRowDto, isArray: true })
  rows: OpenReportRowDto[];

  @ApiProperty({ type: OpenReportTotalsDto })
  totals: OpenReportTotalsDto;
}
