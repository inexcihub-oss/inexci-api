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
import { CidCodeDto } from '../../dto/cid-code.dto';
import { CLINICAL_DOCUMENT_TEXT_MAX } from './create-medical-certificate.dto';

export class ExamReferralItemDto {
  /** Exame solicitado. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  /** Código TUSS do exame, quando o convênio exigir. */
  @IsString()
  @IsOptional()
  @MaxLength(20)
  tussCode?: string;

  /** Detalhe do pedido (lateralidade, região, preparo). */
  @IsString()
  @IsOptional()
  @MaxLength(300)
  observation?: string;
}

export class CreateExamReferralDto {
  /** Ficha de atendimento que origina o pedido. */
  @IsUUID()
  @IsNotEmpty()
  clinicalRecordId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ExamReferralItemDto)
  exams: ExamReferralItemDto[];

  /**
   * Justificativa clínica do pedido (exigida pelos convênios). Pode vir de um
   * modelo já aplicado — por isso o teto é o dos textos de modelo, maior que
   * o corpo do modelo (ver `CLINICAL_DOCUMENT_TEXT_MAX`).
   */
  @IsString()
  @IsOptional()
  @MaxLength(CLINICAL_DOCUMENT_TEXT_MAX)
  clinicalIndication?: string;

  /**
   * Modelo de texto (MIG-06) para a indicação clínica, com os placeholders preenchidos
   * no servidor. Só vale quando o texto não veio: o texto enviado sempre vence.
   */
  @IsUUID()
  @IsOptional()
  templateId?: string;

  /** Sobrescreve os CIDs da ficha, quando o pedido usa outra hipótese. */
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CidCodeDto)
  cidCodes?: CidCodeDto[];
}
