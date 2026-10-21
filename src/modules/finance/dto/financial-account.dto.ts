import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { FinancialAccountType } from 'src/database/entities/financial-account.entity';

const aparar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class FinancialAccountDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: FinancialAccountType, enumName: 'FinancialAccountType' })
  type: FinancialAccountType;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class FindFinancialAccountsDto {
  @ApiPropertyOptional({ description: 'Inclui as contas inativas' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateFinancialAccountDto {
  @ApiProperty({ maxLength: 80, example: 'Caixa Físico' })
  @Transform(aparar)
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da conta' })
  @MaxLength(80)
  name: string;

  @ApiProperty({ enum: FinancialAccountType, enumName: 'FinancialAccountType' })
  @IsEnum(FinancialAccountType)
  type: FinancialAccountType;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateFinancialAccountDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @ValidateIf((_, valor) => valor !== undefined)
  @Transform(aparar)
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da conta' })
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    enum: FinancialAccountType,
    enumName: 'FinancialAccountType',
  })
  @ValidateIf((_, valor) => valor !== undefined)
  @IsEnum(FinancialAccountType)
  type?: FinancialAccountType;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateFinancialAccountStatusDto {
  @ApiProperty()
  @IsBoolean()
  active: boolean;
}
