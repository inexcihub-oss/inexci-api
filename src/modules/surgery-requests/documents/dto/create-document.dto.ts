import { Type } from 'class-transformer';
import { Allow, IsIn, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { DocumentTypes } from 'src/common';

export class CreateDocumentDto {
  @IsNumber()
  @Type(() => Number)
  surgery_request_id: number;

  @IsString()
  @IsNotEmpty()
  // @IsIn(Object.values(DocumentTypes))
  key: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}
