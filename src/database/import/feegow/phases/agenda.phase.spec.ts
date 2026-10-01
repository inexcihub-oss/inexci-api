import {
  AppointmentStatus,
  AppointmentType,
} from 'src/database/entities/appointment.entity';
import { Ledger } from '../../core/ledger';
import { ContextoImportacao } from '../context';
import { LEDGER_CONVENIO } from '../mappers/health-plan.mapper';
import { LEDGER_FUNCIONARIO } from '../mappers/team.mapper';
import { LEDGER_CONSULTA, LEDGER_SALA } from '../mappers/appointment.mapper';
import {
  ag,
  contextoDeTeste,
  exportSintetico,
  OWNER,
} from '../testing/export-sintetico';
import { planejarCadastro } from './cadastro.phase';
import { gravarAgenda, planejarAgenda } from './agenda.phase';
import { Appointment } from 'src/database/entities/appointment.entity';
import { ClinicRoom } from 'src/database/entities/clinic-room.entity';
import { EntityManager } from 'typeorm';

/** Roda o cadastro e depois a agenda no mesmo ledger, como o runner faz. */
function planejar(
  agendamentos: ReturnType<typeof ag>[],
  extras: Record<string, unknown[]> = {},
  ctxParcial: Partial<ContextoImportacao> = {},
) {
  const exp = exportSintetico({ agendamentos, ...extras } as never);
  const donoExistente = new Map([
    [
      'dono@exemplo.com',
      { id: OWNER, ownerId: OWNER, email: 'dono@exemplo.com', temPerfil: true },
    ],
  ]);
  const ctxCadastro = contextoDeTeste({
    usuariosPorEmail: donoExistente,
    ...ctxParcial,
  });
  planejarCadastro(exp, ctxCadastro);
  const ctx = contextoDeTeste({ ...ctxParcial, ledger: ctxCadastro.ledger });
  return { ctx, plano: planejarAgenda(exp, ctx) };
}

describe('planejarAgenda (export sintético)', () => {
  it('cria as salas ativas da clínica importada', () => {
    const { ctx, plano } = planejar([ag('10', '1', '2025-01-10', '0')]);

    expect(plano.salas.map((s) => s.name)).toEqual([
      'Consultório 01',
      'Consultório 02',
    ]);
    expect(plano.salas[0].clinicId).toBe(ctx.ledger.resolver('clinic', '0'));
    expect(ctx.ledger.resolver(LEDGER_SALA, '4')).toBeNull();
  });

  it('leva sala, encaixe, convênio, autor, canal e notas', () => {
    const { ctx, plano } = planejar([
      ag('10', '4', '2025-01-10', '8', {
        id: 'a1',
        local_id: '2',
        is_encaixe: '1',
        usuario_id: '173',
        canal_id: '-1',
        Notas: 'trazer exames',
      }),
    ]);
    const [c] = plano.consultas;

    expect(c).toMatchObject({
      roomId: ctx.ledger.resolver(LEDGER_SALA, '2'),
      isWalkIn: true,
      healthPlanId: ctx.ledger.resolver(LEDGER_CONVENIO, '8'),
      createdById: ctx.ledger.resolver(LEDGER_FUNCIONARIO, '2'),
      notes: '[Doctoralia] trazer exames',
      ownerId: OWNER,
    });
    expect(ctx.ledger.resolver(LEDGER_CONSULTA, 'a1')).toBe(c.id);
  });

  it('convênio que é tipo de consulta vira particular', () => {
    const { plano } = planejar([ag('11', '9', '2025-01-10', '5')]);

    expect(plano.consultas[0].healthPlanId).toBeNull();
  });

  it('horário de São Paulo e data de criação original', () => {
    const { plano } = planejar([
      ag('10', '1', '2025-01-10', '0', { Hora: '14:30:00' }),
    ]);

    expect(plano.consultas[0].scheduledAt.toISOString()).toBe(
      '2025-01-10T17:30:00.000Z',
    );
    expect(plano.consultas[0].createdAt.toISOString()).toBe(
      '2024-12-01T13:00:00.000Z',
    );
  });

  it('duração inválida vira 30 min com aviso', () => {
    const { ctx, plano } = planejar([
      ag('10', '1', '2025-01-10', '0', { tempo: '03' }),
    ]);

    expect(plano.consultas[0].durationMinutes).toBe(30);
    expect(
      ctx.relatorio.avisos.some((a) => a.aviso.startsWith('duração inválida')),
    ).toBe(true);
  });

  describe('status', () => {
    it('aguardando no passado continua aguardando', () => {
      const { plano } = planejar([
        ag('10', '1', '2025-01-10', '0', { status_id: '4' }),
      ]);

      expect(plano.consultas[0].status).toBe(AppointmentStatus.WAITING);
    });

    it('aguardando com atendimento registrado vira realizada', () => {
      const { plano } = planejar(
        [ag('10', '1', '2025-01-10', '0', { id: 'a1', status_id: '4' })],
        { atendimentos: [{ agendamento_id: 'a1', paciente_id: '10' }] },
      );

      expect(plano.consultas[0].status).toBe(AppointmentStatus.COMPLETED);
    });

    it('--passadas-sem-atendimento=no_show reclassifica', () => {
      const { plano } = planejar(
        [ag('10', '1', '2025-01-10', '0', { status_id: '4' })],
        {},
        {
          opcoes: {
            somenteComAtividade: false,
            lembretes: false,
            passadasSemAtendimento: 'no_show',
          },
        },
      );

      expect(plano.consultas[0].status).toBe(AppointmentStatus.NO_SHOW);
    });

    it('cancelada leva o motivo do Feegow', () => {
      const { plano } = planejar([
        ag('10', '1', '2025-01-10', '0', { status_id: '11' }),
      ]);

      expect(plano.consultas[0]).toMatchObject({
        status: AppointmentStatus.CANCELLED,
        cancellationReason: 'Desmarcado pelo paciente',
      });
    });
  });

  describe('lembrete das consultas futuras', () => {
    const futura = () => ag('10', '1', '2026-10-05', '0', { status_id: '1' });

    it('por padrão marca como já lembrada (o Feegow cuidou)', () => {
      const { plano } = planejar([futura()]);

      expect(plano.consultas[0].reminderSentAt).toBeInstanceOf(Date);
    });

    it('--lembretes deixa a INEXCI lembrar', () => {
      const { plano } = planejar(
        [futura()],
        {},
        {
          opcoes: {
            somenteComAtividade: false,
            lembretes: true,
            passadasSemAtendimento: 'manter',
          },
        },
      );

      expect(plano.consultas[0].reminderSentAt).toBeNull();
    });

    it('consulta passada não ganha marca de lembrete', () => {
      const { plano } = planejar([
        ag('10', '1', '2025-01-10', '0', { status_id: '1' }),
      ]);

      expect(plano.consultas[0].reminderSentAt).toBeNull();
    });
  });

  it('tipo: primeira vez, retorno e acompanhamento', () => {
    const { plano } = planejar([
      ag('10', '1', '2025-01-10', '0', { is_primeira_vez: '1' }),
      ag('10', '1', '2025-02-10', '0', { procedimento_id: '30' }),
      ag('11', '9', '2025-03-10', '0'),
    ]);

    expect(plano.consultas.map((c) => c.type)).toEqual([
      AppointmentType.FIRST_VISIT,
      AppointmentType.RETURN,
      AppointmentType.FOLLOW_UP,
    ]);
  });

  it('rejeita reserva sem paciente, paciente excluído e status desconhecido', () => {
    const { ctx, plano } = planejar([
      ag(null, '1', '2025-01-10', '0'),
      ag('12', '1', '2025-01-11', '0'),
      ag('10', '1', '2025-01-12', '0', { status_id: '999' }),
      ag('10', '1', '2025-01-13', '0', { sys_active: '-1' }),
    ]);

    expect(plano.consultas).toHaveLength(0);
    expect(ctx.relatorio.rejeicoes.map((r) => r.motivo)).toEqual([
      'sem paciente (reserva de horário)',
      'paciente não importado',
      'status desconhecido (999)',
    ]);
  });

  it('lista sobreposições do mesmo profissional, ignorando encaixe e cancelada', () => {
    const { ctx } = planejar([
      ag('10', '1', '2025-01-10', '0', { id: 'a1', status_id: '1' }),
      ag('11', '1', '2025-01-10', '0', { id: 'a2', status_id: '1' }),
      ag('13', '1', '2025-01-10', '0', {
        id: 'a3',
        status_id: '1',
        is_encaixe: '1',
      }),
      ag('10', '1', '2025-01-10', '0', {
        id: 'a4',
        status_id: '11',
        Hora: '09:10:00',
      }),
    ]);

    expect(ctx.relatorio.extras.colisoes).toEqual([
      {
        profissional: '1',
        inicio: '2025-01-10T12:00:00.000Z',
        agendamentos: ['a1', 'a2'],
      },
    ]);
  });

  it('rodar de novo pula as consultas e salas já importadas', () => {
    const { ctx } = planejar([ag('10', '1', '2025-01-10', '0')]);
    const exp = exportSintetico({
      agendamentos: [ag('10', '1', '2025-01-10', '0')],
    } as never);
    const segunda = contextoDeTeste({ ledger: ctx.ledger });
    const plano = planejarAgenda(exp, segunda);

    expect(plano.consultas).toHaveLength(0);
    expect(plano.salas).toHaveLength(0);
    expect(segunda.relatorio.pulados.consulta).toBe(1);
  });

  it('sem a clínica no ledger: consulta sem clínica nem sala, com aviso', () => {
    const exp = exportSintetico({
      agendamentos: [ag('10', '1', '2025-01-10', '0')],
    } as never);
    const ctxCadastro = contextoDeTeste();
    planejarCadastro(exp, ctxCadastro);
    const dados = ctxCadastro.ledger.paraObjeto();
    delete dados.clinic;
    const ctx = contextoDeTeste({ ledger: new Ledger(null, dados) });

    const plano = planejarAgenda(exp, ctx);

    expect(plano.salas).toHaveLength(0);
    expect(plano.consultas[0]).toMatchObject({ clinicId: null, roomId: null });
  });
});

describe('gravarAgenda', () => {
  it('grava salas antes das consultas (a consulta aponta para a sala)', async () => {
    const { plano } = planejar([ag('10', '1', '2025-01-10', '0')]);
    const ordem: unknown[] = [];
    const qb = {
      insert: () => qb,
      into: (e: unknown) => (ordem.push(e), qb),
      values: () => qb,
      orIgnore: () => qb,
      execute: async () => undefined,
    };
    const manager = {
      createQueryBuilder: () => qb,
    } as unknown as EntityManager;

    await gravarAgenda(plano, manager);

    expect(ordem).toEqual([ClinicRoom, Appointment]);
  });
});
