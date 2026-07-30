import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CidCodeDto } from '../../dto/cid-code.dto';

/** Atualiza um modelo. O médico dono não muda depois de criado. */
export class UpdateClinicalRecordTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  specialty?: string;

  @IsOptional()
  @IsString()
  anamnesis?: string;

  @IsOptional()
  @IsString()
  physicalExam?: string;

  @IsOptional()
  @IsString()
  diagnosis?: string;

  @IsOptional()
  @IsString()
  conduct?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CidCodeDto)
  cidCodes?: CidCodeDto[];
}
