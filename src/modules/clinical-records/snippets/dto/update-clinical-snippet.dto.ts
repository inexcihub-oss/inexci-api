import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  normalizeShortcut,
  SHORTCUT_MESSAGE,
  SHORTCUT_PATTERN,
} from './create-clinical-snippet.dto';

export class UpdateClinicalSnippetDto {
  @IsOptional()
  @Transform(normalizeShortcut)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(SHORTCUT_PATTERN, { message: SHORTCUT_MESSAGE })
  shortcut?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content?: string;
}
