import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class changePasswordDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
