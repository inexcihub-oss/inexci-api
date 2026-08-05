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

  /** Justificativa clínica do pedido (exigida pelos convênios). */
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  clinicalIndication?: string;

  /** Sobrescreve os CIDs da ficha, quando o pedido usa outra hipótese. */
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CidCodeDto)
  cidCodes?: CidCodeDto[];
}
