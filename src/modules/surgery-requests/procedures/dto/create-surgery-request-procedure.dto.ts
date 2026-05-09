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
  procedureId?: string; // mantido por compatibilidade, não utilizado no save

  @IsString()
  @IsNotEmpty()
  tussCode: string;

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
  surgeryRequestId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcedureItemDto)
  procedures: ProcedureItemDto[];
}
