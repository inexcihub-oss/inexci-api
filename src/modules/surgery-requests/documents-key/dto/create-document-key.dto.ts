import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDocumentKeyDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  file_url?: string;
}
