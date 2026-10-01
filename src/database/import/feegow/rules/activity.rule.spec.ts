import { AppointmentStatus } from 'src/database/entities/appointment.entity';
import { AppointmentActivityType as T } from 'src/database/entities/appointment-activity.entity';
import { atividadesDoLog, EventoDoLog } from './activity.rule';

let minuto = 0;
function ev(
  arx: string,
  statusId: string,
  obs: string | null = null,
  extra: Partial<EventoDoLog> = {},
): EventoDoLog {
  return {
    arx,
    statusId,
    obs,
    motivo: '0',
    quando: new Date(Date.UTC(2025, 0, 10, 12, minuto++)),
    autorId: 'u-1',
    ...extra,
  };
}

describe('atividadesDoLog (MIG-04 §6)', () => {
  beforeEach(() => (minuto = 0));

  it('A vira created com o status inicial e a observação digitada', () => {
    const [a] = atividadesDoLog([ev('A', '1', 'unimed')]);
    expect(a).toMatchObject({
      type: T.CREATED,
      fromStatus: null,
      toStatus: AppointmentStatus.SCHEDULED,
      content: 'unimed',
      userId: 'u-1',
    });
  });

  it('linha do tempo completa: confirma, chega, inicia e finaliza', () => {
    const atividades = atividadesDoLog([
      ev('A', '1'),
      ev('R', '7', 'Altera&ccedil;&atilde;o de status.'),
      ev('R', '4', 'Alteração de status'),
      ev('R', '2', 'Atendimento iniciado pela sala de espera'),
      ev('R', '3', 'Atendimento finalizado'),
    ]);

    expect(
      atividades.map((a) => [a.type, a.fromStatus, a.toStatus, a.content]),
    ).toEqual([
      [T.CREATED, null, 'scheduled', null],
      [T.STATUS_CHANGE, 'scheduled', 'confirmed', null],
      [T.STATUS_CHANGE, 'confirmed', 'waiting', null],
      [
        T.STATUS_CHANGE,
        'waiting',
        'in_progress',
        'Atendimento iniciado pela sala de espera',
      ],
      [T.STATUS_CHANGE, 'in_progress', 'completed', 'Atendimento finalizado'],
    ]);
  });

  it('"Remarcado - motivo" vira rescheduled sem tratar o 15 como cancelamento', () => {
    const atividades = atividadesDoLog([
      ev('A', '1'),
      ev('R', '15', 'Remarcado - Adiantamos a consulta'),
      ev('R', '7', 'Alteração de status'),
    ]);
    expect(atividades[1]).toMatchObject({
      type: T.RESCHEDULED,
      fromStatus: null,
      toStatus: null,
      content: 'Remarcado - Adiantamos a consulta',
    });
    // Segue do status de antes da remarcação, não de "cancelada".
    expect(atividades[2]).toMatchObject({
      fromStatus: 'scheduled',
      toStatus: 'confirmed',
    });
  });

  it('"Remarcado - " sem justificativa perde o hífen solto', () => {
    const [r] = atividadesDoLog([ev('R', '15', 'Remarcado - ')]);
    expect(r.content).toBe('Remarcado');
  });

  it('alteração de horário (escapada) vira rescheduled sem mudar status', () => {
    const [, r] = atividadesDoLog([
      ev('A', '1'),
      ev(
        'R',
        '1',
        'Altera&ccedil;&atilde;o de hor&aacute;rio (de 08:00 para 09:30).',
      ),
    ]);
    expect(r).toMatchObject({
      type: T.RESCHEDULED,
      fromStatus: null,
      toStatus: null,
      content: 'Alteração de horário (de 08:00 para 09:30).',
    });
  });

  it('R sem mudança de status: updated com texto, e nada sem texto', () => {
    const atividades = atividadesDoLog([
      ev('A', '1'),
      ev('R', '1', 'Altera&ccedil;&atilde;o de dados'),
      ev('R', '1', 'Alteração de status'),
      ev('R', '1', null),
    ]);
    expect(atividades).toHaveLength(2);
    expect(atividades[1]).toMatchObject({
      type: T.UPDATED,
      content: 'Alteração de dados',
      fromStatus: null,
      toStatus: null,
    });
  });

  it('motivo diferente de 0 vai no fim do texto', () => {
    const [, c, d] = atividadesDoLog([
      ev('A', '1'),
      ev('R', '11', 'paciente viajou', { motivo: '4' }),
      ev('R', '1', 'Alteração de status', { motivo: '25' }),
    ]);
    expect(c).toMatchObject({
      type: T.STATUS_CHANGE,
      toStatus: 'cancelled',
      content: 'paciente viajou (motivo Feegow 4)',
    });
    expect(d).toMatchObject({
      type: T.STATUS_CHANGE,
      fromStatus: 'cancelled',
      toStatus: 'scheduled',
      content: '(motivo Feegow 25)',
    });
  });

  it('log que começa sem o A: primeira troca sem status de origem', () => {
    const [a] = atividadesDoLog([ev('R', '7', 'Alteração de status')]);
    expect(a).toMatchObject({
      type: T.STATUS_CHANGE,
      fromStatus: null,
      toStatus: 'confirmed',
    });
  });

  it('status desconhecido mantém o anterior; X é ignorado', () => {
    const atividades = atividadesDoLog([
      ev('A', '1'),
      ev('R', '999', 'Alteração de status'),
      ev('X', '1', '. Agendamento excluído'),
    ]);
    expect(atividades).toHaveLength(1);
  });

  it('autor e data vêm do evento', () => {
    const quando = new Date('2023-08-16T12:46:58.000Z');
    const [a] = atividadesDoLog([
      ev('A', '1', null, { autorId: null, quando }),
    ]);
    expect(a.userId).toBeNull();
    expect(a.createdAt).toBe(quando);
  });
});
