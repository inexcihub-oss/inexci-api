import { Mask } from '@tboerc/maskfy';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { UserRole } from 'src/database/entities/user.entity';

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
  @Transform(({ value }) => (value ? Mask.phone.raw(value) : value))
  phone?: string;
}
