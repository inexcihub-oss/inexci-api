import { IsDateString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

/**
 * Teto de itens da agenda numa janela de datas — salvaguarda; uma janela
 * típica (mês/semana) fica bem abaixo disso.
 */
export const APPOINTMENTS_MAX_TAKE = 1000;

/** Intervalo visível da agenda de consultas. */
export class FindAppointmentsDto {
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @IsNotEmpty()
  @IsDateString()
  to!: string;

  /** Filtro opcional por médico (a lista já é escopada aos médicos acessíveis). */
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}
