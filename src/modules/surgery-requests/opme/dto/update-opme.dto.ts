import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UpdateOpmeDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  brand?: string;

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

  @IsOptional()
  @IsNumber()
  quantity?: number;
}
