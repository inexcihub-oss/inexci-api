import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CidCodeDto } from './cid-code.dto';

export class UpdateClinicalRecordDto {
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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CidCodeDto)
  cidCodes?: CidCodeDto[];

  @IsOptional()
  @IsString()
  conduct?: string;

  @IsOptional()
  @IsBoolean()
  surgicalIndication?: boolean;

  @IsOptional()
  @IsUUID()
  procedureId?: string | null;
}
