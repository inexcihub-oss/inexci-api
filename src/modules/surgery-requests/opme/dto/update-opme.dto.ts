import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateOpmeDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  distributor?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;
}
