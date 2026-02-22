import { IsNotEmpty, IsString } from 'class-validator';

export class CreateProcedureDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  tuss_code: string;
}
