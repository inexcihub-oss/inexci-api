import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';

export class CreateActivityDto {
  @IsEnum(ActivityType)
  @IsOptional()
  type?: ActivityType;

  @IsString()
  @IsNotEmpty()
  content: string;
}
