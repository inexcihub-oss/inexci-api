import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
} from 'class-validator';

export class ProcedureItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  procedure_id?: string; // mantido por compatibilidade, não utilizado no save

  @IsString()
  @IsNotEmpty()
  tuss_code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @Type(() => Number)
  @IsNumber()
  quantity: number;
}

export class CreateSurgeryRequestProcedureDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcedureItemDto)
  procedures: ProcedureItemDto[];
}
