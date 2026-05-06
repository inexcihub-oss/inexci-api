import { Type } from 'class-transformer';
import { IsDate, IsString, IsNotEmpty } from 'class-validator';

export class CreateComplaintDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
  @Type(() => Date)
  @IsDate()
  date_call: Date;
  protocol: string;
}
