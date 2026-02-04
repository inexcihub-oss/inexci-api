import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordAuthenticatedDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}
