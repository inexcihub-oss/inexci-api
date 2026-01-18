import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsNumber()
  @Type(() => Number)
  id: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
