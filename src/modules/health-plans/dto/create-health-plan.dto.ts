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

  @IsOptional() @IsString() ansCode?: string;
  @IsOptional() @IsString() cnpj?: string;
  @IsOptional() @IsString() zipCode?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() addressNumber?: string;
  @IsOptional() @IsString() addressComplement?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() authorizationContact?: string;
  @IsOptional() @IsString() authorizationPhone?: string;
  @IsOptional() @IsString() authorizationEmail?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() portalUrl?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(1) defaultPaymentDays?: number;
}
