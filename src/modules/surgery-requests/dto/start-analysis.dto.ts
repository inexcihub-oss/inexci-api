import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class StartAnalysisDto {
  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;

  @IsString()
  requestNumber: string;

  @IsDateString()
  receivedAt: string;

  @IsOptional()
  @IsString()
  quotation1Number?: string;

  @IsOptional()
  @IsDateString()
  quotation1ReceivedAt?: string;

  @IsOptional()
  @IsString()
  quotation2Number?: string;

  @IsOptional()
  @IsDateString()
  quotation2ReceivedAt?: string;

  @IsOptional()
  @IsString()
  quotation3Number?: string;

  @IsOptional()
  @IsDateString()
  quotation3ReceivedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
