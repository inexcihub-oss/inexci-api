import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
  ValidateNested,
} from 'class-validator';

export class ProcedureItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsUUID()
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
  @IsUUID()
  @IsNotEmpty()
  surgeryRequestId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcedureItemDto)
  procedures: ProcedureItemDto[];
}
