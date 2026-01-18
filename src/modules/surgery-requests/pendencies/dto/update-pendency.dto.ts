import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class UpdatePendencyDto {
  @Type(() => Number)
  @IsNumber()
  surgery_request_id: number;

  @IsString()
  @IsNotEmpty()
  key: string;
}
