import { Type } from 'class-transformer';
import { Allow, IsIn, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { DocumentTypes } from 'src/common';

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;

  @IsString()
  @IsNotEmpty()
  // @IsIn(Object.values(DocumentTypes))
  key: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}
