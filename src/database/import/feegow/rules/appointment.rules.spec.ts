import {
  AppointmentStatus,
  AppointmentType,
} from 'src/database/entities/appointment.entity';
import { statusDaConsulta } from './appointment-status.rule';
import { tipoDaConsulta } from './appointment-type.rule';

describe('statusDaConsulta', () => {
  const s = (
    statusId: string,
    extra: Partial<Parameters<typeof statusDaConsulta>[0]> = {},
  ) =>
    statusDaConsulta({
      statusId,
      nomeDoStatus: 'Desmarcado pelo paciente',
      temAtendimento: false,
      passada: false,
      passadasSemAtendimento: 'manter',
      ...extra,
    });

  it.each([
    ['1', AppointmentStatus.SCHEDULED],
    ['7', AppointmentStatus.CONFIRMED],
    ['4', AppointmentStatus.WAITING],
    ['5', AppointmentStatus.WAITING],
    ['2', AppointmentStatus.IN_PROGRESS],
    ['3', AppointmentStatus.COMPLETED],
    ['6', AppointmentStatus.NO_SHOW],
    ['11', AppointmentStatus.CANCELLED],
    ['22', AppointmentStatus.CANCELLED],
  ])('Feegow %s → %s', (id, esperado) => {
    expect(s(id)?.status).toBe(esperado);
  });

  it('cancelada leva o nome do status como motivo', () => {
    expect(s('11')).toEqual({
      status: AppointmentStatus.CANCELLED,
      cancellationReason: 'Desmarcado pelo paciente',
    });
  });

  it('aguardando com atendimento registrado vira realizada', () => {
    expect(s('4', { temAtendimento: true })?.status).toBe(
      AppointmentStatus.COMPLETED,
    );
  });

  it('passada em aberto sem atendimento fica como no Feegow por padrão', () => {
    expect(s('4', { passada: true })?.status).toBe(AppointmentStatus.WAITING);
  });

  it('--passadas-sem-atendimento reclassifica só as passadas em aberto', () => {
    expect(
      s('7', { passada: true, passadasSemAtendimento: 'no_show' })?.status,
    ).toBe(AppointmentStatus.NO_SHOW);
    expect(
      s('7', { passada: false, passadasSemAtendimento: 'no_show' })?.status,
    ).toBe(AppointmentStatus.CONFIRMED);
    expect(
      s('11', { passada: true, passadasSemAtendimento: 'completed' })?.status,
    ).toBe(AppointmentStatus.CANCELLED);
  });

  it('status desconhecido devolve null', () => {
    expect(s('999')).toBeNull();
    expect(s('')).toBeNull();
  });
});

describe('tipoDaConsulta', () => {
  const t = (primeiraVez: string | null, proc: string, prof: string) =>
    tipoDaConsulta({ primeiraVez, procedimentoId: proc, profissionalId: prof });

  it('primeira vez pela marcação ou pelo procedimento de triagem', () => {
    expect(t('1', '10', '1')).toBe(AppointmentType.FIRST_VISIT);
    expect(t('0', '28', '1')).toBe(AppointmentType.FIRST_VISIT);
  });

  it('procedimentos de retorno', () => {
    expect(t('0', '30', '1')).toBe(AppointmentType.RETURN);
    expect(t(null, '24', '1')).toBe(AppointmentType.RETURN);
  });

  it('"convênio" PRIMEIRA CONSULTA -TRIAGEM (11) é primeira consulta; 12 é retorno', () => {
    const c = (convenioId: string, prof = '1') =>
      tipoDaConsulta({
        primeiraVez: '0',
        procedimentoId: '10',
        profissionalId: prof,
        convenioId,
      });
    expect(c('11')).toBe(AppointmentType.FIRST_VISIT);
    expect(c('11', '9')).toBe(AppointmentType.FIRST_VISIT);
    expect(c('12', '9')).toBe(AppointmentType.RETURN);
    expect(c('5')).toBe(AppointmentType.RETURN);
    expect(c('5', '9')).toBe(AppointmentType.FOLLOW_UP);
  });

  it('sessões do profissional de acompanhamento', () => {
    expect(t('0', '10', '9')).toBe(AppointmentType.FOLLOW_UP);
  });

  it('primeira vez vence o profissional de acompanhamento', () => {
    expect(t('1', '10', '9')).toBe(AppointmentType.FIRST_VISIT);
  });

  it('sem pista nenhuma é retorno', () => {
    expect(t(null, '10', '1')).toBe(AppointmentType.RETURN);
  });
});
