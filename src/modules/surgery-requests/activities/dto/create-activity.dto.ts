import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';

export class CreateActivityDto {
  @IsEnum(ActivityType)
  @IsOptional()
  type?: ActivityType;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  mentionedUserIds?: string[];
}
