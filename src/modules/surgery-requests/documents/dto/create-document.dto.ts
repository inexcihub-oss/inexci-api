import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { STORAGE_FOLDERS } from 'src/config/storage.config';

export class CreateDocumentDto {
  // Coluna `uuid`: em rota multipart o DTO é a única barreira (o
  // `SurgeryRequestOwnerGuard` roda antes do parse do corpo).
  @IsUUID()
  @IsNotEmpty()
  surgeryRequestId: string;

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
