import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertDoctorHeaderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logo_url?: string | null;

  @IsOptional()
  @IsIn(['left', 'right'])
  logo_position?: 'left' | 'right';

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content_html?: string | null;
}
