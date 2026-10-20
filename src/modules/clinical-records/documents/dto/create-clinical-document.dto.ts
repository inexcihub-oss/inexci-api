import {
  IsIn,
  IsNotEmpty,
  IsNotIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PASTAS_DE_DOCUMENTO } from 'src/shared/storage/tipo-arquivo';
import { TIPOS_DOCUMENTO_EMITIDO } from '../clinical-documents.constants';

export class CreateClinicalDocumentDto {
  @IsUUID()
  @IsNotEmpty()
  patientId: string;

  @IsUUID()
  @IsOptional()
  clinicalRecordId?: string;

  @IsString()
  @IsOptional()
  @IsNotIn(TIPOS_DOCUMENTO_EMITIDO)
  type?: string;

  @IsString()
  @IsNotEmpty()
  @IsNotIn(TIPOS_DOCUMENTO_EMITIDO)
  key: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(PASTAS_DE_DOCUMENTO)
  folder: string;
}
