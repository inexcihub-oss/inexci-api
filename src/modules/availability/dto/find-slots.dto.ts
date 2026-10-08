import { IsDateString, IsUUID } from 'class-validator';

export class FindSlotsDto {
  @IsUUID()
  doctorId: string;

  /** `YYYY-MM-DD` (São Paulo). */
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
