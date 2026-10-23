import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const SHORTCUT_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const SHORTCUT_MESSAGE =
  'O atalho deve ter só letras minúsculas sem acento, números e hífen.';

export const normalizeShortcut = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.trim().replace(/^\/+/, '').toLowerCase()
    : value;

export class CreateClinicalSnippetDto {
  @Transform(normalizeShortcut)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(SHORTCUT_PATTERN, { message: SHORTCUT_MESSAGE })
  shortcut: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content: string;

  @IsUUID()
  @IsOptional()
  doctorId?: string;
}
