import { IsDateString, IsNotEmpty } from 'class-validator';

export const AGENDA_MAX_TAKE = 1000;

export class FindAgendaDto {
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @IsNotEmpty()
  @IsDateString()
  to!: string;
}
