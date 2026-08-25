import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  OpmeItemFromDocumentDto,
  ReportSectionFromDocumentDto,
  TussItemFromDocumentDto,
} from './create-from-document.dto';

/** Dados confirmados pelo usuário para complementar uma SC pendente. */
export class ApplyDocumentExtractionDto {
  @IsOptional() @IsBoolean() procedure?: boolean;
  @IsOptional() @IsBoolean() hospital?: boolean;
  @IsOptional() @IsBoolean() healthPlan?: boolean;
  @IsOptional() @IsBoolean() report?: boolean;
  @IsOptional() @IsBoolean() tuss?: boolean;
  @IsOptional() @IsBoolean() opme?: boolean;
  @IsOptional() @IsString() procedureName?: string;
  @IsOptional() @IsString() hospitalName?: string;
  @IsOptional() @IsString() healthPlanName?: string;
  @IsOptional() @IsString() healthPlanNumber?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportSectionFromDocumentDto)
  sections?: ReportSectionFromDocumentDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TussItemFromDocumentDto)
  tussItems?: TussItemFromDocumentDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpmeItemFromDocumentDto)
  opmeItems?: OpmeItemFromDocumentDto[];
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  suggestedSuppliers?: string[];
  @IsOptional() @IsString() tempStoragePath?: string;
  @IsOptional() @IsString() originalFileName?: string;
}
