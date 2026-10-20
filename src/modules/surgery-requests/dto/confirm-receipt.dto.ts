import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class ConfirmReceiptDto {
  @IsNumber()
  @Min(0)
  receivedValue: number;

  @IsDateString()
  receivedAt: string;

  @IsOptional()
  @IsString()
  receiptNotes?: string;
}
