import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';

export class CreateChatDto {
  @Type(() => Number)
  @IsNumber()
  surgery_request_id: number;

  @Type(() => Number)
  @IsNumber()
  user_id: number;
}
