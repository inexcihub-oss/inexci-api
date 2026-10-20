import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSurgeryRequestTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsObject()
  templateData: object;
}

export class UpdateSurgeryRequestTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsObject()
  templateData?: object;
}
