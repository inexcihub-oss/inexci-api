import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CidCodeDto } from './cid-code.dto';

/** Atualiza uma ficha ainda não finalizada. Fichas finalizadas são imutáveis. */
export class UpdateClinicalRecordDto {
  @IsOptional()
  @IsString()
  anamnesis?: string;

  @IsOptional()
  @IsString()
  physicalExam?: string;

  @IsOptional()
  @IsString()
  diagnosis?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CidCodeDto)
  cidCodes?: CidCodeDto[];

  @IsOptional()
  @IsString()
  conduct?: string;

  /** Marca o paciente como cirúrgico; a SC é criada ao finalizar. */
  @IsOptional()
  @IsBoolean()
  surgicalIndication?: boolean;

  /**
   * Procedimento escolhido (ou criado) para a SC que nasce da indicação.
   * `null` limpa a escolha.
   */
  @IsOptional()
  @IsUUID()
  procedureId?: string | null;
}
