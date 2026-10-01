import { AppointmentType } from 'src/database/entities/appointment.entity';
import {
  PROCEDIMENTOS_DE_PRIMEIRA_VEZ,
  PROCEDIMENTOS_DE_RETORNO,
  PROFISSIONAIS_DE_ACOMPANHAMENTO,
} from '../regras-do-cliente';

/**
 * Tipo da consulta. O Feegow não tem o campo: deriva da marcação "primeira
 * vez", do procedimento e do profissional (ver `regras-do-cliente.ts`).
 * Sem nenhuma pista, é retorno — a maioria das consultas do export.
 */
export function tipoDaConsulta(params: {
  primeiraVez: string | null;
  procedimentoId: string | null;
  profissionalId: string | null;
}): AppointmentType {
  if (
    params.primeiraVez === '1' ||
    PROCEDIMENTOS_DE_PRIMEIRA_VEZ.has(params.procedimentoId ?? '')
  ) {
    return AppointmentType.FIRST_VISIT;
  }
  if (PROCEDIMENTOS_DE_RETORNO.has(params.procedimentoId ?? '')) {
    return AppointmentType.RETURN;
  }
  if (PROFISSIONAIS_DE_ACOMPANHAMENTO.has(params.profissionalId ?? '')) {
    return AppointmentType.FOLLOW_UP;
  }
  return AppointmentType.RETURN;
}
