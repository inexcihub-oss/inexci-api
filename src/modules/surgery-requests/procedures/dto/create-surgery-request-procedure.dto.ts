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

  @IsString()
  @IsNotEmpty()
  procedure_id: string;

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
