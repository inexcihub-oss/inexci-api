import { AppointmentType } from 'src/database/entities/appointment.entity';
import {
  PROCEDIMENTOS_DE_PRIMEIRA_VEZ,
  PROCEDIMENTOS_DE_RETORNO,
  PROFISSIONAIS_DE_ACOMPANHAMENTO,
} from '../regras-do-cliente';

const CONVENIOS_DE_PRIMEIRA_VEZ = new Set(['11']);
const CONVENIOS_DE_RETORNO = new Set(['12']);

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
