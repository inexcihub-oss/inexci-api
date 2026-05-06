import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { SendMethod } from 'src/shared/constants/send-method';

/**
 * POST /surgery-requests/:id/send
 * Transição: PENDING → SENT
 */
export class SendRequestDto {
  @IsOptional()
  @IsBoolean()
  notify_patient?: boolean;
  @IsEnum(SendMethod)
  method: SendMethod;

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsOptional()
  @IsString()
  to?: string;

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsOptional()
  @IsString()
  subject?: string;

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString({ each: true })
  attachments?: string[];
}
