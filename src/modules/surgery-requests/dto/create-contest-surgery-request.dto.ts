import { IsNotEmpty, IsString } from 'class-validator';

export class CreateContestSurgeryRequestDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
  cancel_reason: string;
}
