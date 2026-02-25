import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { STORAGE_FOLDERS } from 'src/config/storage.config';

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;

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
