import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertDoctorHeaderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @IsOptional()
  @IsIn(['left', 'right'])
  logoPosition?: 'left' | 'right';

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  contentHtml?: string | null;
}
