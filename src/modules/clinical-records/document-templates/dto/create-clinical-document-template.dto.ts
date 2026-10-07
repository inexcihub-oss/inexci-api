import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ClinicalDocumentTemplateKind } from 'src/database/entities/clinical-document-template.entity';

/**
 * Metade do teto dos textos do atestado e do pedido de exame
 * (`CLINICAL_DOCUMENT_TEXT_MAX`): sobra margem para os placeholders crescerem
 * ao serem preenchidos sem o texto aplicado estourar a validação da emissão.
 */
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
