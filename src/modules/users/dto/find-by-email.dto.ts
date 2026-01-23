import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { UserPvs } from 'src/common';

export class FindByEmailUserDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNumber()
  @Type(() => Number)
  @IsIn(Object.values(UserPvs))
  profile: number;
}
