import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Comentário livre no histórico da consulta. */
export class CreateAppointmentCommentDto {
  // Aparado antes de validar: só espaços vira vazio e o `IsNotEmpty` recusa
  // com 400, em vez de gravar um comentário em branco.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Escreva o comentário.' })
  @MaxLength(1000, {
    message: 'O comentário deve ter no máximo 1000 caracteres.',
  })
  content: string;
}
