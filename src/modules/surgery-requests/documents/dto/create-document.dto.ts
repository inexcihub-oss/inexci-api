import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { STORAGE_FOLDERS } from 'src/config/storage.config';

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
  @IsIn(Object.values(STORAGE_FOLDERS))
  folder: string;
}
