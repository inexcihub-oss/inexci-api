import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateOpmeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  supplier_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supplier_names?: string[];

  @Type(() => Number)
  @IsNumber()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  surgeryRequestId: string;
}
