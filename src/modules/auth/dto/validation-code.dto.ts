import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class validationCodeDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  code: string;
}
