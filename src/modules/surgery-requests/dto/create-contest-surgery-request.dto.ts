import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateContestSurgeryRequestDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
  cancel_reason: string;
}
