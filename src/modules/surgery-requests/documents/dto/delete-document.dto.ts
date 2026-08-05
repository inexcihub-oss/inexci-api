import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class DeleteDocumentDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  key: string;

  @IsUUID()
  @IsNotEmpty()
  surgeryRequestId: string;
}
