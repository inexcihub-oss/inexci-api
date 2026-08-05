import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

/**
 * Teto de itens da agenda numa janela de datas — salvaguarda; uma janela
 * típica (mês/semana) fica bem abaixo disso.
 */
export const APPOINTMENTS_MAX_TAKE = 1000;

/** Intervalo visível da agenda de consultas. */
export class FindAppointmentsDto {
  /**
   * Início da janela. Ausente = sem limite inferior — é o que a aba
   * "Realizadas" precisa para listar todo o histórico.
   */
  @IsOptional()
  @IsDateString()
  from?: string;

  /**
   * Fim da janela. Ausente = sem limite superior — é o que a aba "Próximas"
   * precisa para não esconder uma consulta marcada para daqui a três meses.
   */
  @IsOptional()
  @IsDateString()
  to?: string;

  /** Filtro opcional por médico (a lista já é escopada aos médicos acessíveis). */
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  /** Status aceitos, separados por vírgula: `status=scheduled,confirmed`. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.length > 0
      ? value.split(',').map((item) => item.trim())
      : undefined,
  )
  @IsEnum(AppointmentStatus, { each: true })
  status?: AppointmentStatus[];

  /**
   * Ordem por horário. `DESC` nas listas de passado, para que o teto de
   * `APPOINTMENTS_MAX_TAKE` corte as consultas mais antigas e não as recentes.
   */
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';
}
