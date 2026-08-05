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
  @Matches(/^(headers\/|https:\/\/[a-z0-9.-]+\.r2\.cloudflarestorage\.com\/)/, {
    message: 'logoUrl deve ser um caminho do bucket ou URL do R2',
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
