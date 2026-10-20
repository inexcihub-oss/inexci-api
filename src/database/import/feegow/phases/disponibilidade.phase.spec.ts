import { EntityManager } from 'typeorm';
import { DoctorSchedule } from 'src/database/entities/doctor-schedule.entity';
import { Holiday } from 'src/database/entities/holiday.entity';
import { ScheduleBlock } from 'src/database/entities/schedule-block.entity';
import { ContextoImportacao } from '../context';
import { LEDGER_SALA } from '../mappers/appointment.mapper';
import {
  LEDGER_FUNCIONARIO,
  LEDGER_PROFISSIONAL,
} from '../mappers/team.mapper';
import {
  contextoDeTeste,
  exportSintetico,
  OWNER,
} from '../testing/export-sintetico';
import { planejarAgenda } from './agenda.phase';
import { planejarCadastro } from './cadastro.phase';
import {
  gravarDisponibilidade,
  planejarDisponibilidade,
} from './disponibilidade.phase';

function gf(id: string, extra: Record<string, string | null> = {}) {
  return {
    id,
    dia_semana: '2',
    hora_de: '08:00:00',
    hora_ate: '12:00:00',
    profissionalid: '1',
    localid: '1',
    intervalo: '30',
    maximo_encaixes: null,
    inicio_vigencia: null,
    fim_vigencia: null,
    datahora: '2025-01-01 10:00:00',
    ...extra,
  };
}

function bloq(id: string, extra: Record<string, string | null> = {}) {
  return {
    id,
    DataDe: '2026-10-05',
    DataA: '2026-10-05',
    HoraDe: '14:00:00',
    HoraA: '18:00:00',
    FeriadoID: '0',
    ProfissionalID: '1',
    Titulo: 'Congresso',
    Descricao: null,
    Usuario: '173',
    DHUp: '2026-09-01 09:00:00',
    ...extra,
  };
}

function feriado(
  id: string,
  nome: string,
  data: string | null,
  extra: Record<string, string | null> = {},
) {
  return {
    id,
    nome_feriado: nome,
    data,
    recorrente: '|1|',
    bloquear_agenda: '|1|',
    sys_active: '1',
    ...extra,
  };
}

function planejar(
  tabelas: Record<string, unknown[]>,
  opcoes: Partial<ContextoImportacao['opcoes']> = {},
) {
  const exp = exportSintetico({ grade_fixa: [], ...tabelas });
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
  });
  planejarCadastro(exp, ctx0);
  planejarAgenda(exp, contextoDeTeste({ ledger: ctx0.ledger }));
  const ctx = contextoDeTeste({
    ledger: ctx0.ledger,
    hoje: '2026-10-02',
    opcoes: { ...contextoDeTeste().opcoes, ...opcoes },
  });
  return { ctx, plano: planejarDisponibilidade(exp, ctx) };
}

describe('planejarDisponibilidade — grade', () => {
  it('converte dia, horário, sala, intervalo e encaixes; ignora a grade padrão (-1)', () => {
    const { ctx, plano } = planejar({
      grade_fixa: [
        gf('1', { maximo_encaixes: '5' }),
        gf('2', { profissionalid: '-1' }),
      ],
    });
    expect(plano.grades).toHaveLength(1);
    expect(plano.grades[0]).toMatchObject({
      ownerId: OWNER,
      doctorId: ctx.ledger.resolver(LEDGER_PROFISSIONAL, '1'),
      clinicId: ctx.ledger.resolver('clinic', '0'),
      roomId: ctx.ledger.resolver(LEDGER_SALA, '1'),
      weekday: 1,
      startTime: '08:00:00',
      endTime: '12:00:00',
      slotMinutes: 30,
      maxWalkIns: 5,
      active: true,
    });
  });

  it('vigência passada entra inativa; intervalo inválido vira 30 com aviso', () => {
    const { ctx, plano } = planejar({
      grade_fixa: [
        gf('1', { fim_vigencia: '2025-07-23', inicio_vigencia: '2025-07-16' }),
        gf('2', { dia_semana: '3', intervalo: '0' }),
      ],
    });
    expect(plano.grades[0]).toMatchObject({
      validFrom: '2025-07-16',
      validTo: '2025-07-23',
      active: false,
    });
    expect(plano.grades[1].slotMinutes).toBe(30);
    expect(
      ctx.relatorio.avisos.some((a) =>
        a.aviso.startsWith('intervalo inválido'),
      ),
    ).toBe(true);
  });

  it('sobreposição no mesmo dia: o mais recente fica ativo, o outro entra inativo com aviso', () => {
    const { ctx, plano } = planejar({
      grade_fixa: [
        gf('10', { hora_de: '10:00:00', hora_ate: '12:00:00' }),
        gf('11', { hora_de: '09:00:00', hora_ate: '12:00:00' }),
        gf('12', { hora_de: '13:00:00', hora_ate: '16:00:00' }),
      ],
    });
    const porInicio = Object.fromEntries(
      plano.grades.map((g) => [g.startTime, g.active]),
    );
    expect(porInicio).toEqual({
      '10:00:00': false,
      '09:00:00': true,
      '13:00:00': true,
    });
    expect(
      ctx.relatorio.avisos.some((a) => a.aviso.includes('entra inativa')),
    ).toBe(true);
  });

  it('grade_periodo vira um registro por dia da semana do intervalo', () => {
    const { plano } = planejar({
      grade_periodo: [
        {
          id: '1',
          data_de: '2025-05-23',
          data_ate: '2025-05-24',
          hora_de: '08:00:00',
          hora_ate: '12:00:00',
          profissional_id: '1',
          local_id: '1',
          intervalo: '15',
          maximo_encaixes: null,
          datahora: '2025-05-23 11:15:19',
        },
      ],
    });
    expect(
      plano.grades.map((g) => [g.weekday, g.validFrom, g.validTo]),
    ).toEqual([
      [5, '2025-05-23', '2025-05-24'],
      [6, '2025-05-23', '2025-05-24'],
    ]);
  });

  it('profissional não importado e horário invertido são rejeitados', () => {
    const { ctx, plano } = planejar({
      grade_fixa: [
        gf('1', { profissionalid: '99' }),
        gf('2', { hora_de: '12:00:00', hora_ate: '08:00:00' }),
      ],
    });
    expect(plano.grades).toHaveLength(0);
    expect(ctx.relatorio.rejeicoes.map((r) => r.motivo)).toEqual([
      'profissional não importado',
      'dia ou horário inválido',
    ]);
  });
});

describe('planejarDisponibilidade — bloqueios', () => {
  it('bloqueio de período com motivo, autor e horário de São Paulo', () => {
    const { ctx, plano } = planejar({
      agenda_bloqueios: [bloq('1', { Descricao: 'Em São Paulo' })],
    });
    expect(plano.bloqueios[0]).toMatchObject({
      doctorId: ctx.ledger.resolver(LEDGER_PROFISSIONAL, '1'),
      allDay: false,
      reason: 'Congresso — Em São Paulo',
      createdById: ctx.ledger.resolver(LEDGER_FUNCIONARIO, '2'),
    });
    expect(plano.bloqueios[0].startsAt.toISOString()).toBe(
      '2026-10-05T17:00:00.000Z',
    );
    expect(plano.bloqueios[0].endsAt.toISOString()).toBe(
      '2026-10-05T21:00:00.000Z',
    );
  });

  it('00:00–23:59 vira dia inteiro, até a meia-noite seguinte', () => {
    const { plano } = planejar({
      agenda_bloqueios: [
        bloq('1', { HoraDe: '00:00:00', HoraA: '23:59:00', Titulo: null }),
      ],
    });
    expect(plano.bloqueios[0]).toMatchObject({ allDay: true, reason: null });
    expect(plano.bloqueios[0].startsAt.toISOString()).toBe(
      '2026-10-05T03:00:00.000Z',
    );
    expect(plano.bloqueios[0].endsAt.toISOString()).toBe(
      '2026-10-06T03:00:00.000Z',
    );
  });

  it('gerado por feriado fica de fora; duração zero é rejeitada; profissional 0 = clínica toda', () => {
    const { ctx, plano } = planejar({
      agenda_bloqueios: [
        bloq('1', { FeriadoID: '4', ProfissionalID: '0' }),
        bloq('2', { HoraA: '14:00:00' }),
        bloq('3', { ProfissionalID: '0' }),
      ],
    });
    expect(plano.bloqueios).toHaveLength(1);
    expect(plano.bloqueios[0].doctorId).toBeNull();
    expect(ctx.relatorio.rejeicoes[0].motivo).toContain('duração zero');
    expect(
      ctx.relatorio.avisos.some((a) =>
        a.aviso.startsWith('1 bloqueios gerados por feriado'),
      ),
    ).toBe(true);
  });

  it('--bloqueios-so-futuros ignora os que terminaram antes de hoje', () => {
    const { plano } = planejar(
      {
        agenda_bloqueios: [
          bloq('1', { DataDe: '2025-01-10', DataA: '2025-01-10' }),
          bloq('2'),
        ],
      },
      { bloqueiosSoFuturos: true },
    );
    expect(plano.bloqueios).toHaveLength(1);
  });
});

describe('planejarDisponibilidade — feriados', () => {
  it('recorrente e bloqueio vêm das listas |1|; móvel nunca repete; sem data fica de fora', () => {
    const { ctx, plano } = planejar({
      feriados: [
        feriado('1', 'Natal', '2026-12-25'),
        feriado('2', 'Carnaval', '2027-02-09'),
        feriado('3', 'Paixão de Cristo', '2016-03-25', {
          recorrente: null,
          bloquear_agenda: null,
        }),
        feriado('4', 'Corpus Christi', null),
        feriado('5', 'Excluído', '2026-01-01', { sys_active: '-1' }),
      ],
    });
    expect(
      plano.feriados.map((f) => [f.name, f.date, f.recurring, f.blocksAgenda]),
    ).toEqual([
      ['Natal', '2026-12-25', true, true],
      ['Carnaval', '2027-02-09', false, true],
      ['Paixão de Cristo', '2016-03-25', false, false],
    ]);
    expect(ctx.relatorio.avisos.map((a) => a.aviso)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Carnaval muda de data'),
        expect.stringContaining('sem data no Feegow (Corpus Christi)'),
      ]),
    );
  });
});

describe('disponibilidade — idempotência e gravação', () => {
  it('segunda rodada no mesmo ledger não duplica', () => {
    const tabelas = {
      grade_fixa: [gf('1')],
      agenda_bloqueios: [bloq('1')],
      feriados: [feriado('1', 'Natal', '2026-12-25')],
    };
    const primeira = planejar(tabelas);
    const exp = exportSintetico(tabelas);
    const segunda = planejarDisponibilidade(
      exp,
      contextoDeTeste({ ledger: primeira.ctx.ledger, hoje: '2026-10-02' }),
    );
    expect(segunda).toEqual({ grades: [], bloqueios: [], feriados: [] });
  });

  it('gravar insere grade, bloqueios e feriados', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ execute, orIgnore: jest.fn() });
    const into = jest.fn().mockReturnValue({ values });
    const manager = {
      createQueryBuilder: () => ({ insert: () => ({ into }) }),
    } as unknown as EntityManager;
    const { plano } = planejar({
      grade_fixa: [gf('1')],
      agenda_bloqueios: [bloq('1')],
      feriados: [feriado('1', 'Natal', '2026-12-25')],
    });
    await gravarDisponibilidade(plano, manager);
    expect(into.mock.calls.map((c) => c[0])).toEqual([
      DoctorSchedule,
      ScheduleBlock,
      Holiday,
    ]);
  });
});
