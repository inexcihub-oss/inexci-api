import { ApiProperty } from '@nestjs/swagger';
import { FinancialAccountType } from 'src/database/entities/financial-account.entity';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import { ReportPeriodQueryDto } from './finance-report.dto';

export class AccountStatementQueryDto extends ReportPeriodQueryDto {}

export class AccountStatementAccountDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: FinancialAccountType, enumName: 'FinancialAccountType' })
  type: FinancialAccountType;
}

export class AccountStatementEntryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: Date;

  @ApiProperty({
    enum: FinancialEntryDirection,
    enumName: 'FinancialEntryDirection',
  })
  direction: FinancialEntryDirection;

  @ApiProperty({ enum: FinancialEntryKind, enumName: 'FinancialEntryKind' })
  kind: FinancialEntryKind;

  @ApiProperty({ example: '150.00' })
  amount: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ example: '1250.00' })
  balance: string;
}

export class AccountStatementDto {
  @ApiProperty({ type: AccountStatementAccountDto })
  account: AccountStatementAccountDto;

  @ApiProperty({ example: '1100.00' })
  openingBalance: string;

  @ApiProperty({ example: '1250.00' })
  closingBalance: string;

  @ApiProperty({ type: AccountStatementEntryDto, isArray: true })
  entries: AccountStatementEntryDto[];
}
