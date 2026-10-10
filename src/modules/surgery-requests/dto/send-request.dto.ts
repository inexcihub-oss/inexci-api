import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { SendMethod } from 'src/shared/constants/send-method';

export class SendRequestDto {
  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;

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

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsOptional()
  @IsString()
  cc?: string;

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsOptional()
  @IsBoolean()
  useSourceDocument?: boolean;

  @ValidateIf((o) => o.method === SendMethod.DOCUMENT)
  @IsOptional()
  @IsDateString()
  sentAt?: string;
}
