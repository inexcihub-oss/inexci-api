import { EntityManager } from 'typeorm';
import { AppointmentActivity } from 'src/database/entities/appointment-activity.entity';
import { AppointmentActivityType as T } from 'src/database/entities/appointment-activity.entity';
import { ContextoImportacao } from '../context';
import { LEDGER_CONSULTA } from '../mappers/appointment.mapper';
import { LEDGER_HISTORICO } from '../mappers/activity.mapper';
import { LEDGER_FUNCIONARIO } from '../mappers/team.mapper';
import {
  ag,
  contextoDeTeste,
  exportSintetico,
  OWNER,
} from '../testing/export-sintetico';
import { planejarAgenda } from './agenda.phase';
import { planejarCadastro } from './cadastro.phase';
import { gravarHistorico, planejarHistorico } from './historico.phase';

function log(
  id: string,
  agendamento: string,
  arx: string,
  status: string,
  dataHora: string,
  obs: string | null = null,
  usuario = '173',
) {
  return {
    id,
    agendamento_id: agendamento,
    arx,
    status_id: status,
    data_hora: dataHora,
    data: '2025-01-10',
    hora: '09:00:00',
    obs,
    motivo: '0',
    usuario,
  };
}

const AGENDAMENTOS = [
  ag('10', '4', '2025-01-10', '0', { id: 'a1' }),
  ag('10', '4', '2025-02-10', '0', { id: 'a2', sys_active: '-1' }),
];

/** Cadastro → agenda → histórico no mesmo ledger, como o runner faz. */
function planejar(
  logs: ReturnType<typeof log>[],
  ledger?: ContextoImportacao['ledger'],
) {
  const exp = exportSintetico({
    agendamentos: AGENDAMENTOS,
    log_marcacoes: logs,
  } as never);
  const ctx0 = contextoDeTeste({
    usuariosPorEmail: new Map([
      [
        'dono@exemplo.com',
        {
          id: OWNER,
          ownerId: OWNER,
          email: 'dono@exemplo.com',
          temPerfil: true,
        },
      ],
    ]),
    ...(ledger ? { ledger } : {}),
  });
  if (!ledger) {
    planejarCadastro(exp, ctx0);
    planejarAgenda(exp, contextoDeTeste({ ledger: ctx0.ledger }));
  }
  const ctx = contextoDeTeste({ ledger: ctx0.ledger });
  return { ctx, plano: planejarHistorico(exp, ctx) };
}

describe('planejarHistorico (export sintético)', () => {
  it('ordena por data_hora, liga à consulta importada e resolve o autor', () => {
    const { ctx, plano } = planejar([
      log('3', 'a1', 'R', '3', '2025-01-10 10:00:00', 'Atendimento finalizado'),
      log('1', 'a1', 'A', '1', '2025-01-02 08:15:00', 'protocolo'),
      log(
        '2',
        'a1',
        'R',
        '2',
        '2025-01-10 09:05:00',
        'Atendimento iniciado pela sala de espera',
        '0',
      ),
    ]);
    const consulta = ctx.ledger.resolver(LEDGER_CONSULTA, 'a1');

    expect(plano.atividades.map((a) => a.type)).toEqual([
      T.CREATED,
      T.STATUS_CHANGE,
      T.STATUS_CHANGE,
    ]);
    expect(plano.atividades.every((a) => a.appointmentId === consulta)).toBe(
      true,
    );
    expect(plano.atividades[0]).toMatchObject({
      content: 'protocolo',
      userId: ctx.ledger.resolver(LEDGER_FUNCIONARIO, '2'),
    });
    // 08:15 em São Paulo = 11:15Z
    expect(plano.atividades[0].createdAt.toISOString()).toBe(
      '2025-01-02T11:15:00.000Z',
    );
    // usuário 0 = sistema
    expect(plano.atividades[1].userId).toBeNull();
    expect(ctx.ledger.resolver(LEDGER_HISTORICO, 'a1')).toBe(consulta);
    expect(ctx.relatorio.paraJson()).toBeDefined();
  });

  it('eventos de consulta não importada ficam de fora com aviso', () => {
    const { ctx, plano } = planejar([
      log('1', 'a2', 'A', '1', '2025-01-02 08:15:00'),
      log('2', 'a2', 'X', '1', '2025-01-03 08:15:00', '. Agendamento excluído'),
    ]);
    expect(plano.atividades).toHaveLength(0);
    expect(
      ctx.relatorio.avisos.some((a) =>
        a.aviso.startsWith('2 eventos de consultas não importadas'),
      ),
    ).toBe(true);
  });

  it('data_hora inválida rejeita só o evento', () => {
    const { ctx, plano } = planejar([
      log('1', 'a1', 'A', '1', '2025-01-02 08:15:00'),
      log('2', 'a1', 'R', '7', 'lixo'),
    ]);
    expect(plano.atividades).toHaveLength(1);
    expect(ctx.relatorio.rejeicoes.some((r) => r.idOrigem === '2')).toBe(true);
  });

  it('log sem evento aproveitável não entra no ledger (o --verificar não acusa falta)', () => {
    const { ctx, plano } = planejar([
      log('1', 'a1', 'X', '1', '2025-01-03 08:15:00', '. Agendamento excluído'),
    ]);
    expect(plano.atividades).toHaveLength(0);
    expect(ctx.ledger.resolver(LEDGER_HISTORICO, 'a1')).toBeNull();
  });

  it('segunda rodada no mesmo ledger não duplica', () => {
    const logs = [log('1', 'a1', 'A', '1', '2025-01-02 08:15:00')];
    const primeira = planejar(logs);
    const segunda = planejar(logs, primeira.ctx.ledger);
    expect(segunda.plano.atividades).toHaveLength(0);
  });

  it('gravar insere as atividades em AppointmentActivity', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ execute, orIgnore: jest.fn() });
    const into = jest.fn().mockReturnValue({ values });
    const manager = {
      createQueryBuilder: () => ({ insert: () => ({ into }) }),
    } as unknown as EntityManager;
    const { plano } = planejar([
      log('1', 'a1', 'A', '1', '2025-01-02 08:15:00'),
    ]);

    await gravarHistorico(plano, manager);

    expect(into).toHaveBeenCalledWith(AppointmentActivity);
    expect(values).toHaveBeenCalledWith(plano.atividades);
  });
});
