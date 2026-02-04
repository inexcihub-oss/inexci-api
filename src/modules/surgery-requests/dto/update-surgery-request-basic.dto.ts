import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsDateString } from 'class-validator';

export class UpdateSurgeryRequestBasicDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  id?: number;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;
}
