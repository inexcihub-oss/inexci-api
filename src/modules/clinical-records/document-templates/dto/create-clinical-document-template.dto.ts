import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ClinicalDocumentTemplateKind } from 'src/database/entities/clinical-document-template.entity';

/** Mesmo limite dos campos de texto do atestado e do pedido de exame. */
export const DOCUMENT_TEMPLATE_BODY_MAX = 2000;

export class CreateClinicalDocumentTemplateDto {
  @IsEnum(ClinicalDocumentTemplateKind)
  kind: ClinicalDocumentTemplateKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(DOCUMENT_TEMPLATE_BODY_MAX)
  body: string;

  /** Médico dono do modelo. Default: o médico padrão do usuário. */
  @IsUUID()
  @IsOptional()
  doctorId?: string;
}
