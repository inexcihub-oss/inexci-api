import { IsBoolean, IsOptional, IsString } from 'class-validator';

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
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() payment_terms?: string;
  @IsOptional() @IsString() delivery_time?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
