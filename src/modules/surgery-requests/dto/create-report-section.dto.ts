import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateReportSectionDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}
