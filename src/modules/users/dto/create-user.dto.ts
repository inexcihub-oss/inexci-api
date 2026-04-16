import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { UserRole } from 'src/database/entities/user.entity';
import { PhoneTransform } from 'src/shared/pipes/phone-mask.pipe';

export class CreateUserDto {
  @IsOptional()
  @IsString()
  @IsIn(Object.values(UserRole))
  role?: UserRole;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @PhoneTransform()
  phone?: string;
}
