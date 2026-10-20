import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateAppointmentCommentDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Escreva o comentário.' })
  @MaxLength(1000, {
    message: 'O comentário deve ter no máximo 1000 caracteres.',
  })
  content: string;
}
