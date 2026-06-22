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
  @IsArray()
  @IsUUID('4', { each: true })
  manufacturerIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  manufacturerNames?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  supplierIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supplierNames?: string[];

  @Type(() => Number)
  @IsNumber()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  surgeryRequestId: string;
}
