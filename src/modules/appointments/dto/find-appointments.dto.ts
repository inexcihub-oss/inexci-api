import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

/**
 * Teto de itens da agenda numa janela de datas — salvaguarda; uma janela
 * típica (mês/semana) fica bem abaixo disso.
 */
export const APPOINTMENTS_MAX_TAKE = 1000;

/**
 * Lista vinda da query string. Aceita os dois formatos que chegam do
 * cliente: separado por vírgula (`status=a,b`) e parâmetro repetido
 * (`status=a&status=b`, que o parser entrega como array) — ou os dois
 * misturados. Devolver `undefined` para o array fazia o filtro ser ignorado
 * em silêncio e a lista voltar inteira (fail-open). Valor que não é texto
 * nem lista passa adiante para a validação recusar.
 */
export function listaDaQuery(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  const partes = Array.isArray(value) ? value : [value];
  if (!partes.every((parte) => typeof parte === 'string')) return value;
  const itens = (partes as string[])
    .flatMap((parte) => parte.split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return itens.length > 0 ? itens : undefined;
}

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

  /**
   * Vários médicos: `doctorIds=a,b` ou `doctorIds=a&doctorIds=b` (filtro do hub).
   */
  @IsOptional()
  @Transform(({ value }) => listaDaQuery(value))
  @IsUUID('all', { each: true })
  doctorIds?: string[];

  /** Paginação: quantas pular. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  /** Paginação: tamanho da página (até `APPOINTMENTS_MAX_TAKE`). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(APPOINTMENTS_MAX_TAKE)
  take?: number;

  /** Devolve também `countByDoctorId` do recorte inteiro (sem paginação). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  withDoctorCounts?: boolean;

  /** Status aceitos: `status=scheduled,confirmed` ou o parâmetro repetido. */
  @IsOptional()
  @Transform(({ value }) => listaDaQuery(value))
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
