import { AppointmentType } from 'src/database/entities/appointment.entity';
import {
  PROCEDIMENTOS_DE_PRIMEIRA_VEZ,
  PROCEDIMENTOS_DE_RETORNO,
  PROFISSIONAIS_DE_ACOMPANHAMENTO,
} from '../regras-do-cliente';

/**
 * "Convênios" do Feegow que na verdade dizem o tipo da consulta (subconjunto
 * de `CONVENIOS_QUE_SAO_TIPO_DE_CONSULTA`, que os tira do convênio do
 * paciente e da consulta). O 5 (CONSULTA PARTICULAR CONSULTORIO) não diz o
 * tipo, só que é particular.
 */
const CONVENIOS_DE_PRIMEIRA_VEZ = new Set(['11']); // PRIMEIRA CONSULTA -TRIAGEM
const CONVENIOS_DE_RETORNO = new Set(['12']); // REVER EXAMES / RETORNO

/**
 * Tipo da consulta. O Feegow não tem o campo: deriva da marcação "primeira
 * vez", do procedimento, do "convênio" que é tipo de consulta e do
 * profissional (ver `regras-do-cliente.ts`).
 * Sem nenhuma pista, é retorno — a maioria das consultas do export.
 */
export function tipoDaConsulta(params: {
  primeiraVez: string | null;
  procedimentoId: string | null;
  profissionalId: string | null;
  convenioId?: string | null;
}): AppointmentType {
  if (
    params.primeiraVez === '1' ||
    PROCEDIMENTOS_DE_PRIMEIRA_VEZ.has(params.procedimentoId ?? '') ||
    CONVENIOS_DE_PRIMEIRA_VEZ.has(params.convenioId ?? '')
  ) {
    return AppointmentType.FIRST_VISIT;
  }
  if (
    PROCEDIMENTOS_DE_RETORNO.has(params.procedimentoId ?? '') ||
    CONVENIOS_DE_RETORNO.has(params.convenioId ?? '')
  ) {
    return AppointmentType.RETURN;
  }
  if (PROFISSIONAIS_DE_ACOMPANHAMENTO.has(params.profissionalId ?? '')) {
    return AppointmentType.FOLLOW_UP;
  }
  return AppointmentType.RETURN;
}
