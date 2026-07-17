import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CheckEmailDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;
}
