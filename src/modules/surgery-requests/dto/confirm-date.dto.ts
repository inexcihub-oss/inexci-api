import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class ConfirmDateDto {
  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;

  @IsIn([0, 1, 2])
  selectedDateIndex: 0 | 1 | 2;
}
