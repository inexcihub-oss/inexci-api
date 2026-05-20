import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpsertDoctorHeaderDto {
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: true })
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
