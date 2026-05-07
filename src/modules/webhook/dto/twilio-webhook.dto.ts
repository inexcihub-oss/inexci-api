import { IsOptional, IsString } from 'class-validator';

export class TwilioWebhookDto {
  @IsString()
  From: string;

  @IsOptional()
  @IsString()
  Body: string;

  @IsString()
  MessageSid: string;

  @IsOptional()
  @IsString()
  NumMedia?: string;

  @IsOptional()
  @IsString()
  MediaUrl0?: string;

  @IsOptional()
  @IsString()
  MediaContentType0?: string;

  @IsOptional()
  @IsString()
  MediaUrl1?: string;

  @IsOptional()
  @IsString()
  MediaContentType1?: string;

  @IsOptional()
  @IsString()
  MediaUrl2?: string;

  @IsOptional()
  @IsString()
  MediaContentType2?: string;

  @IsOptional()
  @IsString()
  MediaUrl3?: string;

  @IsOptional()
  @IsString()
  MediaContentType3?: string;

  @IsOptional()
  @IsString()
  MediaUrl4?: string;

  @IsOptional()
  @IsString()
  MediaContentType4?: string;

  @IsOptional()
  @IsString()
  To?: string;

  @IsOptional()
  @IsString()
  AccountSid?: string;
}
