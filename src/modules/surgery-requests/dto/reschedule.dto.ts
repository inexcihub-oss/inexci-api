import { IsDateString } from 'class-validator';

export class RescheduleDto {
  @IsDateString()
  newDate: string;
}
