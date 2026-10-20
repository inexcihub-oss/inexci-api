import { IsString } from 'class-validator';

export class ContestPaymentDto {
  @IsString()
  to: string;

  @IsString()
  subject: string;

  @IsString()
  message: string;

  @IsString({ each: true })
  attachments?: string[];
}
