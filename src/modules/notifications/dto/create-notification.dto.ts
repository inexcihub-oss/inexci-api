import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { NotificationType } from 'src/database/entities/notification.entity';

export class CreateNotificationDto {
  @IsString()
  @IsNotEmpty()
  user_id: string;

  @IsEnum(NotificationType)
  @IsOptional()
  type?: NotificationType;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsOptional()
  link?: string;

  @IsOptional()
  @Type(() => Object)
  metadata?: Record<string, any>;
}
