import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpsertDoctorHeaderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^(https:\/\/.+|[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9]+)?)$/, {
    message:
      'logoUrl deve ser uma URL https válida ou um caminho relativo do arquivo',
  })
  logoUrl?: string | null;

  @IsOptional()
  @IsIn(['left', 'center', 'right'])
  logoPosition?: 'left' | 'center' | 'right';

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  contentHtml?: string | null;
}
