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

  /**
   * Usuários mencionados com @ no comentário. Quem valida se cada um
   * realmente acessa a SC é o `ActivityMentionsService` — aqui só garantimos
   * formato e um teto (o limite evita um corpo gigante virar N notificações).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  mentionedUserIds?: string[];
}
