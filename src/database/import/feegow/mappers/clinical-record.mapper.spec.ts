import { LinhaCsv } from '../../core/csv';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import { contextoDeTeste, OWNER } from '../testing/export-sintetico';
import { LEDGER_CONSULTA } from './appointment.mapper';
import { LEDGER_FICHA, planejarFichas } from './clinical-record.mapper';
import { LEDGER_PACIENTE } from './patient.mapper';
import { LEDGER_PROFISSIONAL } from './team.mapper';

/** Ledger como as fases anteriores deixariam: 2 pacientes, 2 médicos, 1 consulta. */
function contexto(): ContextoImportacao {
  const ctx = contextoDeTeste();
  ctx.ledger.registrar(LEDGER_PACIENTE, '10', 'pac-10');
  ctx.ledger.registrar(LEDGER_PACIENTE, '11', 'pac-11');
  ctx.ledger.registrar(LEDGER_PROFISSIONAL, '1', 'med-1');
  ctx.ledger.registrar(LEDGER_PROFISSIONAL, '4', 'med-4');
  ctx.ledger.registrar(LEDGER_CONSULTA, 'ag1', 'consulta-1');
  return ctx;
}

function exportCom(tabelas: Record<string, Partial<LinhaCsv>[]>) {
  return new ExportFeegow(null, {
    agendamentos: [{ id: 'ag1', paciente_id: '10', profissional_id: '1' }],
    ...tabelas,
  } as Record<string, LinhaCsv[]>);
}

function atd(extra: Record<string, string | null> = {}) {
  return {
    id: 'a1',
    paciente_id: '10',
    agendamento_id: 'ag1',
    DATA: '2025-01-10',
    hora_inicio: '09:05:00',
    hora_fim: '09:40:00',
    profissional_id: '1',
    sys_user: '0',
    ...extra,
  };
}

describe('planejarFichas — vínculo com a consulta', () => {
  it('mesmo paciente e mesmo médico: ficha ligada à consulta', () => {
    const ctx = contexto();
    const [f] = planejarFichas(exportCom({ atendimentos: [atd()] }), ctx);
    expect(f).toMatchObject({
      patientId: 'pac-10',
      doctorId: 'med-1',
      appointmentId: 'consulta-1',
    });
  });

  it('agendamento de outro paciente: ficha solta, com aviso', () => {
    const ctx = contexto();
    const [f] = planejarFichas(
      exportCom({ atendimentos: [atd({ paciente_id: '11' })] }),
      ctx,
    );
    expect(f).toMatchObject({ patientId: 'pac-11', appointmentId: null });
    expect(ctx.relatorio.avisos).toContainEqual(
      expect.objectContaining({
        idOrigem: 'atd:a1',
        aviso: 'agendamento ag1 é de outro paciente: ficha sem consulta',
      }),
    );
  });

  it('agendamento de outro profissional: ficha solta, com aviso', () => {
    const ctx = contexto();
    const [f] = planejarFichas(
      exportCom({ atendimentos: [atd({ profissional_id: '4' })] }),
      ctx,
    );
    expect(f).toMatchObject({ doctorId: 'med-4', appointmentId: null });
    expect(ctx.relatorio.avisos).toContainEqual(
      expect.objectContaining({
        idOrigem: 'atd:a1',
        aviso: 'agendamento ag1 é de outro profissional: ficha sem consulta',
      }),
    );
  });

  it('agendamento fora do export: não liga às cegas', () => {
    const ctx = contexto();
    const [f] = planejarFichas(
      exportCom({ agendamentos: [], atendimentos: [atd()] }),
      ctx,
    );
    expect(f.appointmentId).toBeNull();
  });
});

describe('planejarFichas — documentos emitidos no Feegow', () => {
  const doc = (tipo: string, conteudo: string) => ({
    tipo,
    PacienteId: '10',
    conteudo: `<p>${conteudo}</p>`,
    datahora: '2025-08-04 13:29:39',
    Usuario_ID: '999',
  });
  const DOCS = [
    doc('Atestado', 'Atesto repouso.'),
    doc('Prescrição', 'Dipirona.'),
    doc('Atestado', 'Atesto comparecimento.'),
  ];

  it('vários documentos do mesmo paciente no mesmo instante não colidem', () => {
    const ctx = contexto();
    const fichas = planejarFichas(
      exportCom({ prescricao_atestados_diagnosticos_pedidosexames: DOCS }),
      ctx,
    );
    expect(fichas.map((f) => f.conduct)).toEqual([
      expect.stringContaining('Atesto repouso.'),
      expect.stringContaining('Dipirona.'),
      expect.stringContaining('Atesto comparecimento.'),
    ]);
    expect(fichas.every((f) => f.doctorId === OWNER)).toBe(true);
    expect(ctx.relatorio.pulados.ficha).toBeUndefined();
    const chaves = Object.keys(ctx.ledger.paraObjeto()[LEDGER_FICHA]);
    expect(chaves).toEqual([
      'presc:10:2025-08-04 13:29:39:atestado:0',
      'presc:10:2025-08-04 13:29:39:prescricao:0',
      'presc:10:2025-08-04 13:29:39:atestado:1',
    ]);
  });

  it('segunda rodada no mesmo ledger não duplica nenhum', () => {
    const ctx = contexto();
    const exp = exportCom({
      prescricao_atestados_diagnosticos_pedidosexames: DOCS,
    });
    planejarFichas(exp, ctx);
    const segunda = contextoDeTeste({ ledger: ctx.ledger });
    expect(planejarFichas(exp, segunda)).toHaveLength(0);
    expect(segunda.relatorio.pulados.ficha).toBe(3);
  });

  it('ledger com a chave antiga (sem tipo): o 1º já entrou, os outros entram agora', () => {
    const ctx = contexto();
    ctx.ledger.registrar(
      LEDGER_FICHA,
      'presc:10:2025-08-04 13:29:39',
      'ficha-antiga',
    );
    const fichas = planejarFichas(
      exportCom({ prescricao_atestados_diagnosticos_pedidosexames: DOCS }),
      ctx,
    );
    expect(fichas.map((f) => f.conduct)).toEqual([
      expect.stringContaining('Dipirona.'),
      expect.stringContaining('Atesto comparecimento.'),
    ]);
    expect(
      ctx.ledger.resolver(
        LEDGER_FICHA,
        'presc:10:2025-08-04 13:29:39:atestado:0',
      ),
    ).toBe('ficha-antiga');
  });
});
