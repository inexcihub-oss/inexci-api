import { IsNotEmpty, IsString } from 'class-validator';

export class CreateContestSurgeryRequestDto {
  @IsString()
  @IsNotEmpty()
  surgeryRequestId: string;
  cancelReason: string;
}
