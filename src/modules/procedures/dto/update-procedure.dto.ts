import { IsOptional, IsString } from 'class-validator';

export class UpdateProcedureDto {
  @IsOptional()
  @IsString()
  name?: string;
}
