import { IsDateString, IsNumber, Min } from 'class-validator';

export class UpdateReceiptDto {
  @IsNumber()
  @Min(0)
  receivedValue: number;

  @IsDateString()
  receivedAt: string;
}
