import { IsDateString, IsUUID } from 'class-validator';

export class FindSlotsDto {
  @IsUUID()
  doctorId: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
