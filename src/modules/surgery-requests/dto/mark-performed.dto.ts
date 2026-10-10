import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class MarkPerformedDto {
  @IsDateString()
  surgeryPerformedAt: string;

  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;
}
