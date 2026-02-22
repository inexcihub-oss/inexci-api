import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * POST /surgery-requests/:id/start-analysis
 * Transição: SENT → IN_ANALYSIS
 */
export class StartAnalysisDto {
  @IsString()
  request_number: string;

  @IsDateString()
  received_at: string;

  @IsOptional()
  @IsString()
  quotation_1_number?: string;

  @IsOptional()
  @IsDateString()
  quotation_1_received_at?: string;

  @IsOptional()
  @IsString()
  quotation_2_number?: string;

  @IsOptional()
  @IsDateString()
  quotation_2_received_at?: string;

  @IsOptional()
  @IsString()
  quotation_3_number?: string;

  @IsOptional()
  @IsDateString()
  quotation_3_received_at?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
