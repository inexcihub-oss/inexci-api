import { Mask } from '@tboerc/maskfy';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsString,
  MinLength,
} from 'class-validator';
import { UserPvs, UserStatuses } from 'src/common';

export class CreateUserDto {
  @IsNumber()
  @Type(() => Number)
  @IsIn(Object.values(UserPvs))
  pv: number;

  @IsNumber()
  @Type(() => Number)
  @IsIn(Object.values(UserStatuses))
  status: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => Mask.phone.raw(value))
  phone: string;

  @IsNumber()
  @Type(() => Number)
  clinic_id: number; 

}
