import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PrescriptionItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  quantity?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  instructions?: string;
}

export class CreatePrescriptionDto {
  @IsUUID()
  @IsNotEmpty()
  clinicalRecordId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items: PrescriptionItemDto[];

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
