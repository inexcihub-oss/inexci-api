import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { PASTAS_DE_DOCUMENTO } from 'src/shared/storage/tipo-arquivo';

export class CreateDocumentDto {
  @IsUUID()
  @IsNotEmpty()
  surgeryRequestId: string;

  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(PASTAS_DE_DOCUMENTO)
  folder: string;
}
