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
  supplier_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supplier_names?: string[];

  @IsOptional()
  @IsNumber()
  quantity?: number;
}
