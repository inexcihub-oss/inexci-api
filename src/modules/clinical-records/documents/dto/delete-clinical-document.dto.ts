import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteClinicalDocumentDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  key: string;
}
