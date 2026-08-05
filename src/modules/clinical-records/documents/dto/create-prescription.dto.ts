import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PrescriptionItemDto {
  /** Medicamento prescrito (nome + concentração). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  /** Quantidade a dispensar (ex.: `1 caixa`, `30 comprimidos`). */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  quantity?: string;

  /** Posologia (ex.: `1 comprimido a cada 8h por 5 dias`). */
  @IsString()
  @IsOptional()
  @MaxLength(500)
  instructions?: string;
}

export class CreatePrescriptionDto {
  /** Ficha de atendimento que origina a receita. */
  @IsUUID()
  @IsNotEmpty()
  clinicalRecordId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items: PrescriptionItemDto[];

  /** Orientações gerais impressas ao final da receita. */
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
