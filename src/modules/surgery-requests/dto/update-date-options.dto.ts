import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
} from 'class-validator';

export class UpdateDateOptionsDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  notifyPatient?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsDateString({}, { each: true })
  dateOptions: string[];
}
