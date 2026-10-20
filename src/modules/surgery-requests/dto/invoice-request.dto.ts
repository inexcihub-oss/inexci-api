import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class InvoiceRequestDto {
  @IsString()
  invoiceProtocol: string;

  @IsDateString()
  invoiceSentAt: string;

  @IsNumber()
  @Min(0)
  invoiceValue: number;

  @IsOptional()
  @IsString()
  invoiceNotes?: string;

  @IsOptional()
  @IsDateString()
  paymentDeadline?: string;

  @IsOptional()
  @IsBoolean()
  setAsDefaultForHealthPlan?: boolean;
}
