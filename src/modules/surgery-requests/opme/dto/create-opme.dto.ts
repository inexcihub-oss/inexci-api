import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateOpmeDto {
  @IsString()
  @IsNotEmpty()
  name: string;
  distributor: string;
  brand: string;
  @Type(() => Number)
  @IsNumber()
  quantity: number;
  surgery_request_id: string;
}
