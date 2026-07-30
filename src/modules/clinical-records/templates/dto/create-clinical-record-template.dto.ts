import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CidCodeDto } from '../../dto/cid-code.dto';

export class CreateClinicalRecordTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** Médico dono do modelo. Default: o médico padrão do usuário. */
  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  specialty?: string;

  @IsString()
  @IsOptional()
  anamnesis?: string;

  @IsString()
  @IsOptional()
  physicalExam?: string;

  @IsString()
  @IsOptional()
  diagnosis?: string;

  @IsString()
  @IsOptional()
  conduct?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CidCodeDto)
  cidCodes?: CidCodeDto[];
}
