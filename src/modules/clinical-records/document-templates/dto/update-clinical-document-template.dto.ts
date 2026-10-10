import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DOCUMENT_TEMPLATE_BODY_MAX } from './create-clinical-document-template.dto';

export class UpdateClinicalDocumentTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(DOCUMENT_TEMPLATE_BODY_MAX)
  body?: string;
}
