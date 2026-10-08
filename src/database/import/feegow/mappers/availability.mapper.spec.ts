import { LinhaCsv } from '../../core/csv';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import { contextoDeTeste } from '../testing/export-sintetico';
import {
  LEDGER_BLOQUEIO,
  planejarBloqueios,
  planejarFeriados,
  planejarGrades,
  diasDaSemanaDoBloqueio,
} from './availability.mapper';
import { LEDGER_PROFISSIONAL } from './team.mapper';

// `hoje` do contexto de teste: 2026-09-26 (sábado).

function contexto(
  opcoes: Partial<ContextoImportacao['opcoes']> = {},
): ContextoImportacao {
  const ctx = contextoDeTeste({
    opcoes: { ...contextoDeTeste().opcoes, ...opcoes },
  });
  ctx.ledger.registrar(LEDGER_PROFISSIONAL, '1', 'med-1');
  return ctx;
}

const exportCom = (tabelas: Record<string, Partial<LinhaCsv>[]>) =>
  new ExportFeegow(null, tabelas as Record<string, LinhaCsv[]>);

/** Grade fixa de segunda (Feegow `dia_semana` 2), 08–12h. */
function gf(id: string, extra: Record<string, string | null> = {}) {
  return {
    id,
    dia_semana: '2',
    hora_de: '08:00:00',
    hora_ate: '12:00:00',
    profissionalid: '1',
    intervalo: '30',
    inicio_vigencia: null,
    fim_vigencia: null,
    datahora: '2025-01-01 10:00:00',
    ...extra,
  };
}

/** Grade por período (2026-10-05 é segunda). */
function gp(id: string, extra: Record<string, string | null> = {}) {
  return {
    id,
    data_de: '2026-10-05',
    data_ate: '2026-10-05',
    hora_de: '09:00:00',
    hora_ate: '11:00:00',
    profissional_id: '1',
    intervalo: '30',
    datahora: '2026-09-01 10:00:00',
    ...extra,
  };
}

const porOrigem = (ctx: ContextoImportacao, grades: { id: string }[]) => {
  const ledger = ctx.ledger.paraObjeto().schedule ?? {};
  const origem = new Map(Object.entries(ledger).map(([k, v]) => [v, k]));
  return Object.fromEntries(grades.map((g) => [origem.get(g.id), g]));
};

describe('planejarGrades — sobreposição', () => {
  it('período avulso não desliga a grade semanal permanente', () => {
    const ctx = contexto();
    const grades = porOrigem(
      ctx,
      planejarGrades(
        exportCom({ grade_fixa: [gf('1')], grade_periodo: [gp('7')] }),
        ctx,
      ),
    );
    expect(grades['fixa:1:1']).toMatchObject({ active: true, validTo: null });
    expect(grades['periodo:7:1']).toMatchObject({
      active: false,
      validFrom: '2026-10-05',
      validTo: '2026-10-05',
    });
    expect(ctx.relatorio.avisos).toContainEqual(
      expect.objectContaining({
        idOrigem: 'periodo:7:1',
        aviso: 'sobrepõe fixa:1:1 (08:00–12:00): entra inativa para revisão',
      }),
    );
  });

  it('grade com início futuro substitui a atual só a partir dali: as duas ficam ativas', () => {
    const ctx = contexto();
    const grades = porOrigem(
      ctx,
      planejarGrades(
        exportCom({
          grade_fixa: [
            gf('1'),
            gf('2', {
              inicio_vigencia: '2027-01-04',
              datahora: '2026-09-20 10:00:00',
            }),
          ],
        }),
        ctx,
      ),
    );
    expect(grades['fixa:1:1']).toMatchObject({
      active: true,
      validFrom: null,
      validTo: '2027-01-03',
    });
    expect(grades['fixa:2:1']).toMatchObject({
      active: true,
      validFrom: '2027-01-04',
      validTo: null,
    });
  });

  it('a mais antiga, mesmo cadastrada depois, também é encerrada na véspera da outra', () => {
    const ctx = contexto();
    const grades = porOrigem(
      ctx,
      planejarGrades(
        exportCom({
          grade_fixa: [
            gf('1', { inicio_vigencia: '2027-01-04' }),
            gf('2', { datahora: '2026-09-20 10:00:00' }),
          ],
        }),
        ctx,
      ),
    );
    expect(grades['fixa:2:1']).toMatchObject({
      active: true,
      validTo: '2027-01-03',
    });
    expect(grades['fixa:1:1']).toMatchObject({ active: true, validTo: null });
  });

  it('substituição que já começou: a antiga entra inativa', () => {
    const ctx = contexto();
    const grades = porOrigem(
      ctx,
      planejarGrades(
        exportCom({
          grade_fixa: [
            gf('1'),
            gf('2', {
              inicio_vigencia: '2026-03-02',
              datahora: '2026-02-20 10:00:00',
            }),
          ],
        }),
        ctx,
      ),
    );
    expect(grades['fixa:1:1']).toMatchObject({
      active: false,
      validTo: '2026-03-01',
    });
    expect(grades['fixa:2:1'].active).toBe(true);
  });

  it('grade futura com fim não desliga a permanente em uso', () => {
    const ctx = contexto();
    const grades = porOrigem(
      ctx,
      planejarGrades(
        exportCom({
          grade_fixa: [
            gf('1'),
            gf('2', {
              inicio_vigencia: '2027-01-04',
              fim_vigencia: '2027-03-29',
              datahora: '2026-09-20 10:00:00',
            }),
          ],
        }),
        ctx,
      ),
    );
    expect(grades['fixa:1:1']).toMatchObject({ active: true, validTo: null });
    expect(grades['fixa:2:1'].active).toBe(false);
  });

  it('duas permanentes iguais: fica a cadastrada por último no Feegow, não o maior id', () => {
    const ctx = contexto();
    const grades = porOrigem(
      ctx,
      planejarGrades(
        exportCom({
          grade_fixa: [
            gf('9', { datahora: '2024-01-01 10:00:00' }),
            gf('3', { datahora: '2025-06-01 10:00:00' }),
          ],
        }),
        ctx,
      ),
    );
    expect(grades['fixa:3:1'].active).toBe(true);
    expect(grades['fixa:9:1'].active).toBe(false);
  });

  it('períodos em datas diferentes não se sobrepõem', () => {
    const ctx = contexto();
    const grades = planejarGrades(
      exportCom({
        grade_periodo: [
          gp('7'),
          gp('8', { data_de: '2026-10-12', data_ate: '2026-10-12' }),
        ],
      }),
      ctx,
    );
    expect(grades.map((g) => g.active)).toEqual([true, true]);
  });
});

function bloq(id: string, extra: Record<string, string | null> = {}) {
  return {
    id,
    DataDe: '2026-10-05',
    DataA: '2026-10-07',
    HoraDe: '14:00:00',
    HoraA: '18:00:00',
    FeriadoID: '0',
    ProfissionalID: '1',
    Titulo: 'Congresso',
    DHUp: '2026-09-01 09:00:00',
    ...extra,
  };
}

describe('planejarBloqueios — vários dias', () => {
  it('janela de horário em vários dias vira um bloqueio por dia', () => {
    const ctx = contexto();
    const blocos = planejarBloqueios(
      exportCom({ agenda_bloqueios: [bloq('5')] }),
      ctx,
    );
    expect(
      blocos.map((b) => [b.startsAt.toISOString(), b.endsAt.toISOString()]),
    ).toEqual([
      ['2026-10-05T17:00:00.000Z', '2026-10-05T21:00:00.000Z'],
      ['2026-10-06T17:00:00.000Z', '2026-10-06T21:00:00.000Z'],
      ['2026-10-07T17:00:00.000Z', '2026-10-07T21:00:00.000Z'],
    ]);
    expect(blocos.every((b) => !b.allDay && b.doctorId === 'med-1')).toBe(true);
    expect(ctx.ledger.paraObjeto()[LEDGER_BLOQUEIO]).toEqual({
      '5': blocos[0].id,
      '5:2026-10-05': blocos[0].id,
      '5:2026-10-06': blocos[1].id,
      '5:2026-10-07': blocos[2].id,
    });
    expect(ctx.relatorio.aceitos.bloqueio).toBe(3);

    const segunda = contexto();
    segunda.ledger.registrar(LEDGER_BLOQUEIO, '5', blocos[0].id);
    expect(
      planejarBloqueios(exportCom({ agenda_bloqueios: [bloq('5')] }), segunda),
    ).toHaveLength(0);
  });

  it('dia inteiro em vários dias continua um bloqueio só', () => {
    const blocos = planejarBloqueios(
      exportCom({
        agenda_bloqueios: [bloq('5', { HoraDe: null, HoraA: null })],
      }),
      contexto(),
    );
    expect(blocos).toHaveLength(1);
    expect(blocos[0]).toMatchObject({ allDay: true });
    expect(blocos[0].endsAt.toISOString()).toBe('2026-10-08T03:00:00.000Z');
  });

  it('dia inteiro no fim do horário de verão termina à meia-noite local', () => {
    // 17/02/2018 ainda era -02:00; a meia-noite de 18/02 já é -03:00 (25 h).
    const blocos = planejarBloqueios(
      exportCom({
        agenda_bloqueios: [
          bloq('6', {
            DataDe: '2018-02-17',
            DataA: '2018-02-17',
            HoraDe: null,
            HoraA: null,
          }),
        ],
      }),
      contexto(),
    );
    expect(blocos[0].startsAt.toISOString()).toBe('2018-02-17T02:00:00.000Z');
    expect(blocos[0].endsAt.toISOString()).toBe('2018-02-18T03:00:00.000Z');
  });

  it('janela que vira a noite segue contínua', () => {
    const blocos = planejarBloqueios(
      exportCom({
        agenda_bloqueios: [
          bloq('5', { HoraDe: '22:00:00', HoraA: '06:00:00' }),
        ],
      }),
      contexto(),
    );
    expect(blocos).toHaveLength(1);
    expect(blocos[0].startsAt.toISOString()).toBe('2026-10-06T01:00:00.000Z');
    expect(blocos[0].endsAt.toISOString()).toBe('2026-10-07T09:00:00.000Z');
  });

  it('--bloqueios-so-futuros descarta os dias que já passaram', () => {
    const blocos = planejarBloqueios(
      exportCom({
        agenda_bloqueios: [bloq('5', { DataDe: '2026-09-25' })],
      }),
      contexto({ bloqueiosSoFuturos: true }),
    );
    expect(blocos[0].startsAt.toISOString()).toBe('2026-09-26T17:00:00.000Z');
    expect(blocos).toHaveLength(12);
  });

  it('janela repetida por mais de um ano é recusada', () => {
    const ctx = contexto();
    expect(
      planejarBloqueios(
        exportCom({ agenda_bloqueios: [bloq('5', { DataA: '2028-01-01' })] }),
        ctx,
      ),
    ).toHaveLength(0);
    expect(ctx.relatorio.rejeicoes[0].motivo).toMatch(/máximo 366/);
  });
});

describe('planejarFeriados — ativos', () => {
  it('feriado inativo no Feegow fica de fora, com aviso', () => {
    const f = (id: string, sys_active: string) => ({
      id,
      nome_feriado: `Feriado ${id}`,
      data: '2026-12-25',
      recorrente: '|1|',
      bloquear_agenda: '|1|',
      sys_active,
    });
    const ctx = contexto();
    const feriados = planejarFeriados(
      exportCom({ feriados: [f('1', '1'), f('2', '0'), f('3', '-1')] }),
      ctx,
    );
    expect(feriados.map((x) => x.name)).toEqual(['Feriado 1']);
    expect(ctx.relatorio.avisos).toContainEqual(
      expect.objectContaining({
        entidade: 'feriado',
        aviso: '1 feriados inativos no Feegow não importados',
      }),
    );
  });
});

describe('planejarBloqueios — recorrente sem data', () => {
  it('sem DataDe/DataA e com DiasSemana: rejeita dizendo que é recorrente e precisa ser recriado', () => {
    const ctx = contexto();
    const blocos = planejarBloqueios(
      exportCom({
        agenda_bloqueios: [
          bloq('7', { DataDe: null, DataA: null, DiasSemana: '2' }),
        ],
      }),
      ctx,
    );
    expect(blocos).toHaveLength(0);
    expect(ctx.relatorio.rejeicoes).toContainEqual(
      expect.objectContaining({
        idOrigem: '7',
        motivo: expect.stringMatching(
          /^bloqueio recorrente sem data \(segunda, 14:00–18:00\).*recriar manualmente$/,
        ),
      }),
    );
  });

  it('data lixo continua "data inválida"', () => {
    const ctx = contexto();
    planejarBloqueios(
      exportCom({
        agenda_bloqueios: [bloq('8', { DataDe: '31/02', DiasSemana: '2' })],
      }),
      ctx,
    );
    expect(ctx.relatorio.rejeicoes).toContainEqual(
      expect.objectContaining({ idOrigem: '8', motivo: 'data inválida' }),
    );
  });

  it('diasDaSemanaDoBloqueio lê os formatos do Feegow (1 = domingo)', () => {
    expect(diasDaSemanaDoBloqueio('1 2 3 4 5 6 7')).toHaveLength(7);
    expect(diasDaSemanaDoBloqueio('|4|,|2|')).toEqual(['segunda', 'quarta']);
    expect(diasDaSemanaDoBloqueio(null)).toEqual([]);
  });
});
