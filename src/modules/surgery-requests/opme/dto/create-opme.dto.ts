import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateOpmeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
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

  @IsUUID()
  @IsNotEmpty()
  surgeryRequestId: string;
}
