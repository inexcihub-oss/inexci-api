import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CidCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description: string;
}
