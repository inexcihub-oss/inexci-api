import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateMessageDto {
  @Type(() => Number)
  @IsNumber()
  chat_id: number;

  @IsString()
  @IsNotEmpty()
  message: string;
}
