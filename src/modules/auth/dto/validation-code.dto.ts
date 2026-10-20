import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { NormalizeEmail } from 'src/shared/validators/normalize-email.decorator';

export class validationCodeDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @NormalizeEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  code: string;
}
