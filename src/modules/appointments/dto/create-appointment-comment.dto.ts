import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Comentário livre no histórico da consulta. */
export class CreateAppointmentCommentDto {
  @IsString()
  @IsNotEmpty({ message: 'Escreva o comentário.' })
  @MaxLength(1000, {
    message: 'O comentário deve ter no máximo 1000 caracteres.',
  })
  content: string;
}
