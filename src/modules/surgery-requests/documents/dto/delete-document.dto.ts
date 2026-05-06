import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteDocumentDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
}
