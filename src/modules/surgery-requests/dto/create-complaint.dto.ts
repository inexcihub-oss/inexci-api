import { Type } from 'class-transformer';
import { IsDate, IsString, IsNotEmpty } from 'class-validator';

export class CreateComplaintDto {
  @IsString()
  @IsNotEmpty()
  surgeryRequestId: string;
  @Type(() => Date)
  @IsDate()
  dateCall: Date;
  protocol: string;
}
