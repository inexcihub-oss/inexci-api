import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { STORAGE_FOLDERS } from 'src/config/storage.config';

export class CreateClinicalDocumentDto {
  @IsUUID()
  @IsNotEmpty()
  patientId: string;

  /** Vínculo opcional com a ficha de atendimento que originou o documento. */
  @IsUUID()
  @IsOptional()
  clinicalRecordId?: string;

  /** Tipo do documento (ex.: 'exam_report'). Default no banco: 'additional_document'. */
  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  /** Pasta de destino no bucket. */
  @IsString()
  @IsNotEmpty()
  @IsIn(Object.values(STORAGE_FOLDERS))
  folder: string;
}
