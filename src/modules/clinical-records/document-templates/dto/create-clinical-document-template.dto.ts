import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ClinicalDocumentTemplateKind } from 'src/database/entities/clinical-document-template.entity';

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

  @IsUUID()
  @IsOptional()
  doctorId?: string;
}
