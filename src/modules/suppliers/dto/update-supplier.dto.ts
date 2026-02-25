import { IsOptional, IsString } from 'class-validator';

export class UpdateSupplierDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() cnpj?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() contact_name?: string;
  @IsOptional() @IsString() contact_phone?: string;
  @IsOptional() @IsString() contact_email?: string;
  @IsOptional() @IsString() zip_code?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() address_number?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
}
