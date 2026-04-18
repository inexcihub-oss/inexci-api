import * as dayjs from 'dayjs';
import { Mask } from '@tboerc/maskfy';
import { Transform } from 'class-transformer';
import { PhoneTransform } from 'src/shared/pipes/phone-mask.pipe';
import {
  IsDate,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CompleteRegisterDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => Mask.cpf.raw(value))
  cpf: string;

  @IsString()
  @IsNotEmpty()
  @PhoneTransform()
  phone: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsString()
  @IsIn(['m', 'f', ''])
  gender: string;

  @IsDate()
  @IsOptional()
  @Transform(({ value }) =>
    value ? dayjs(value, 'DD/MM/YYYY').toDate() : null,
  )
  birth_date: Date;
}
