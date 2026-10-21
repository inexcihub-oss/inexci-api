import { AppointmentType } from '../entities/appointment.entity';
import {
  PrecoCandidato,
  escolherPrecoMaisEspecifico,
} from './service-price.repository';

const MEDICO = 'medico-1';
const OUTRO_MEDICO = 'medico-2';

function preco(
  id: string,
  doctorId: string | null,
  appointmentType: AppointmentType | null,
  updatedAt = '2026-01-01T00:00:00Z',
): PrecoCandidato {
  return {
    id,
    doctorId,
    appointmentType,
    amount: '100.00',
    updatedAt: new Date(updatedAt),
  };
}

const todos = preco('todos', null, null);
const tipo = preco('tipo', null, AppointmentType.RETURN);
const medico = preco('medico', MEDICO, null);
const medicoETipo = preco('medico+tipo', MEDICO, AppointmentType.RETURN);
const outroMedico = preco('outro-medico', OUTRO_MEDICO, null);
const outroTipo = preco('outro-tipo', null, AppointmentType.FIRST_VISIT);

describe('escolherPrecoMaisEspecifico', () => {
  it.each([
    [
      'médico + tipo vence tudo',
      [todos, tipo, medico, medicoETipo],
      { doctorId: MEDICO, type: AppointmentType.RETURN },
      'medico+tipo',
    ],
    [
      'sem médico + tipo, vale o do médico',
      [todos, tipo, medico],
      { doctorId: MEDICO, type: AppointmentType.RETURN },
      'medico',
    ],
    [
      'sem regra do médico, vale a do tipo',
      [todos, tipo, outroMedico],
      { doctorId: MEDICO, type: AppointmentType.RETURN },
      'tipo',
    ],
    [
      'sem médico nem tipo, vale a regra geral',
      [todos, outroMedico, outroTipo],
      { doctorId: MEDICO, type: AppointmentType.RETURN },
      'todos',
    ],
    [
      'regra de outro médico nunca casa',
      [outroMedico],
      { doctorId: MEDICO, type: AppointmentType.RETURN },
      null,
    ],
    [
      'regra de outro tipo nunca casa',
      [outroTipo, medicoETipo],
      { doctorId: MEDICO, type: AppointmentType.FOLLOW_UP },
      null,
    ],
    [
      'sem médico no critério, ignora as regras por médico',
      [medico, medicoETipo, tipo],
      { doctorId: null, type: AppointmentType.RETURN },
      'tipo',
    ],
    [
      'sem tipo no critério, ignora as regras por tipo',
      [tipo, medicoETipo, medico],
      { doctorId: MEDICO, type: null },
      'medico',
    ],
    ['lista vazia', [], { doctorId: MEDICO, type: null }, null],
  ])('%s', (_caso, candidatos, criterio, esperado) => {
    expect(escolherPrecoMaisEspecifico(candidatos, criterio)?.id ?? null).toBe(
      esperado,
    );
  });

  it('no empate, vale a regra alterada por último', () => {
    const antiga = preco('antiga', MEDICO, null, '2026-01-01T00:00:00Z');
    const nova = preco('nova', MEDICO, null, '2026-05-01T00:00:00Z');

    expect(
      escolherPrecoMaisEspecifico([antiga, nova], {
        doctorId: MEDICO,
        type: null,
      })?.id,
    ).toBe('nova');
    expect(
      escolherPrecoMaisEspecifico([nova, antiga], {
        doctorId: MEDICO,
        type: null,
      })?.id,
    ).toBe('nova');
  });
});
