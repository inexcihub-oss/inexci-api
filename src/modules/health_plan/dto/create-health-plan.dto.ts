import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateHealthPlanDto {
  @IsString()
  name: string;

  @IsOptional() @IsString() ans_code?: string;
  @IsOptional() @IsString() cnpj?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() authorization_contact?: string;
  @IsOptional() @IsString() authorization_phone?: string;
  @IsOptional() @IsString() authorization_email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() portal_url?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(1) default_payment_days?: number;
}
