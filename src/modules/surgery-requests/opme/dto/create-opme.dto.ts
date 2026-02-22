import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateOpmeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  distributor?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @Type(() => Number)
  @IsNumber()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
}
