import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateHealthPlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsOptional() @IsString() ans_code?: string;
  @IsOptional() @IsString() cnpj?: string;
  @IsOptional() @IsString() authorization_contact?: string;
  @IsOptional() @IsString() authorization_phone?: string;
  @IsOptional() @IsString() authorization_email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() portal_url?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(1) default_payment_days?: number;
}
