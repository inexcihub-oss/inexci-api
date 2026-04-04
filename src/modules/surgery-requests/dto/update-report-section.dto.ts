import { IsOptional, IsString } from 'class-validator';

export class UpdateReportSectionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
