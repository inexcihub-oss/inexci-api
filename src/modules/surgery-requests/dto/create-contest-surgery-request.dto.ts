import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateContestSurgeryRequestDto {
  @Type(() => Number)
  @IsNumber()
  surgery_request_id: number;

  @IsString()
  @IsNotEmpty()
  cancel_reason: string;
}
