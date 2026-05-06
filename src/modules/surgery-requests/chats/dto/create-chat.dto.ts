import { IsString, IsNotEmpty } from 'class-validator';

export class CreateChatDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
  user_id: string;
}
