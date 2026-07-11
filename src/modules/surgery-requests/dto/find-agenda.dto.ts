import { IsDateString, IsNotEmpty } from 'class-validator';

/**
 * Teto de itens da agenda numa janela de datas. Uma janela típica (mês/semana)
 * fica muito abaixo disso; o limite existe apenas como salvaguarda.
 */
export const AGENDA_MAX_TAKE = 1000;

/**
 * Intervalo visível da agenda. Substitui o antigo `status=5,6,7,8` (que
 * carregava todas as cirurgias agendadas de uma vez) por uma consulta pela
 * `surgeryDate` dentro do período visível (P7/P8).
 */
export class FindAgendaDto {
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @IsNotEmpty()
  @IsDateString()
  to!: string;
}
