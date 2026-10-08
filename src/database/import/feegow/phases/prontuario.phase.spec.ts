import { EntityManager } from 'typeorm';
import { ClinicalRecord } from 'src/database/entities/clinical-record.entity';
import { ClinicalRecordTemplate } from 'src/database/entities/clinical-record-template.entity';
import { ContextoImportacao } from '../context';
import { LEDGER_CONSULTA } from '../mappers/appointment.mapper';
import { LEDGER_FICHA } from '../mappers/clinical-record.mapper';
import { LEDGER_PACIENTE } from '../mappers/patient.mapper';
import { LEDGER_PROFISSIONAL } from '../mappers/team.mapper';
import {
  ag,
  contextoDeTeste,
  exportSintetico,
  OWNER,
} from '../testing/export-sintetico';
import { planejarAgenda } from './agenda.phase';
import { planejarCadastro } from './cadastro.phase';
import { gravarProntuario, planejarProntuario } from './prontuario.phase';

const AGENDAMENTOS = [ag('10', '1', '2025-01-10', '0', { id: 'ag1' })];

const FORMULARIOS = [
  { id: '1', Nome: 'Primeira Consulta', sysActive: '1' },
  { id: '3', Nome: 'Caixa Livre', sysActive: '1' },
  { id: '8', Nome: 'Antigo', sysActive: '-1' },
  { id: '-4', Nome: 'Primeira Consulta', sysActive: '1' },
];

const IA = '<h3>Queixa principal</h3><p>Dor.</p><h3>Plano</h3><p>RM.</p>';

function atd(id: string, extra: Record<string, string | null> = {}) {
  return {
    id,
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

function fp(
  id: string,
  modelo: string,
  atendimento: string | null,
  ativo = '1',
  paciente = '10',
) {
  return {
    id,
    modelo_id: modelo,
    paciente_id: paciente,
    sys_date: '2025-01-10 09:10:00',
    sys_user: '0',
    sys_active: ativo,
    atendimento_id: atendimento,
  };
}

function linhaN(
  id: string,
  conteudo: string,
  extra: Record<string, string | null> = {},
) {
  return {
    id,
    paciente_id: '10',
    tipo_informacao: 'x',
    conteudo_resumo: conteudo,
    profissionail_id: '1',
    data_hora: '2025-01-10 09:10:00',
    is_active: '1',
    ...extra,
  };
}

/** Cadastro → agenda → prontuário no mesmo ledger, como o runner faz. */
function planejar(
  tabelas: Record<string, unknown[]>,
  opcoes: Partial<ContextoImportacao['opcoes']> = {},
) {
  const exp = exportSintetico({
    agendamentos: AGENDAMENTOS,
    formularios: FORMULARIOS,
    ...tabelas,
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
  });
  planejarCadastro(exp, ctx0);
  planejarAgenda(exp, contextoDeTeste({ ledger: ctx0.ledger }));
  const ctx = contextoDeTeste({
    ledger: ctx0.ledger,
    opcoes: { ...contextoDeTeste().opcoes, ...opcoes },
  });
  return { ctx, plano: planejarProntuario(exp, ctx) };
}

describe('planejarProntuario (export sintético)', () => {
  it('atendimento vira ficha finalizada ligada à consulta, com data e médico do Feegow', () => {
    const { ctx, plano } = planejar({
      atendimentos: [atd('a1')],
      formularios_preenchidos: [fp('100', '3', 'a1')],
      _3: [linhaN('100', ' : <p>Evolução boa</p>')],
    });
    const [f] = plano.fichas;

    expect(f).toMatchObject({
      ownerId: OWNER,
      patientId: ctx.ledger.resolver(LEDGER_PACIENTE, '10'),
      doctorId: ctx.ledger.resolver(LEDGER_PROFISSIONAL, '1'),
      appointmentId: ctx.ledger.resolver(LEDGER_CONSULTA, 'ag1'),
      anamnesis: '<p>Evolução boa</p>',
      cidCodes: null,
      surgicalIndication: false,
    });
    // 09:05 e 09:40 em São Paulo
    expect(f.createdAt.toISOString()).toBe('2025-01-10T12:05:00.000Z');
    expect(f.finalizedAt.toISOString()).toBe('2025-01-10T12:40:00.000Z');
    expect(f.updatedAt).toEqual(f.finalizedAt);
    expect(ctx.ledger.resolver(LEDGER_FICHA, 'atd:a1')).toBe(f.id);
  });

  it('dois atendimentos no mesmo agendamento: só o primeiro leva a consulta', () => {
    const { plano } = planejar({
      atendimentos: [
        atd('a2', { hora_inicio: '10:00:00', hora_fim: '10:10:00' }),
        atd('a1'),
      ],
    });
    const [primeiro, segundo] = plano.fichas;
    expect(primeiro.appointmentId).not.toBeNull();
    expect(segundo.appointmentId).toBeNull();
  });

  it('atendimento sem formulário vira ficha vazia, com aviso', () => {
    const { ctx, plano } = planejar({ atendimentos: [atd('a1')] });
    expect(plano.fichas[0]).toMatchObject({
      anamnesis: null,
      physicalExam: null,
      diagnosis: null,
      conduct: null,
    });
    expect(
      ctx.relatorio.avisos.some((a) => a.aviso.includes('fichas vazias')),
    ).toBe(true);
  });

  it('hora de fim inválida ou anterior ao início: finaliza no início', () => {
    const { plano } = planejar({
      atendimentos: [atd('a1', { hora_fim: '08:00:00' })],
    });
    expect(plano.fichas[0].finalizedAt).toEqual(plano.fichas[0].createdAt);
  });

  it('formulário solto vira ficha sem consulta, com a data do formulário', () => {
    const { plano } = planejar({
      formularios_preenchidos: [fp('101', '3', null)],
      _3: [
        linhaN('101', ' : texto', {
          data_hora: '2024-06-28 09:00:00',
          profissionail_id: null,
        }),
      ],
    });
    expect(plano.fichas).toHaveLength(1);
    expect(plano.fichas[0]).toMatchObject({
      appointmentId: null,
      doctorId: OWNER,
      anamnesis: 'texto',
    });
    expect(plano.fichas[0].createdAt.toISOString()).toBe(
      '2024-06-28T12:00:00.000Z',
    );
  });

  it('rascunho com texto fica de fora com aviso; --incluir-rascunhos traz marcado', () => {
    const tabelas = {
      atendimentos: [atd('a1')],
      formularios_preenchidos: [
        fp('100', '3', 'a1', '0'),
        fp('102', '3', 'a1', '-1'),
      ],
      _3: [linhaN('100', ' : rascunho'), linhaN('102', ' : excluído')],
    };
    const sem = planejar(tabelas);
    expect(sem.plano.fichas[0].anamnesis).toBeNull();
    expect(
      sem.ctx.relatorio.avisos.some((a) =>
        a.aviso.startsWith('1 formulários em rascunho'),
      ),
    ).toBe(true);

    const com = planejar(tabelas, { incluirRascunhos: true });
    expect(com.plano.fichas[0].anamnesis).toContain('(rascunho no Feegow)');
    expect(com.plano.fichas[0].anamnesis).not.toContain('excluído');
  });

  it('resumo de IA igual ao formulário é ignorado; diferente entra na ficha', () => {
    const base = {
      atendimentos: [atd('a1')],
      formularios_preenchidos: [fp('100', '-4', 'a1')],
      '_-4': [linhaN('100', `Primeira Consulta : ${IA}`)],
    };
    const igual = planejar({
      ...base,
      pacientes_ai_summary: [
        {
          id: '1',
          paciente_id: '10',
          atendimento_id: 'a1',
          sys_active: '1',
          conteudo: IA,
          data: '2025-01-10 09:30:00',
          sys_user: '0',
        },
      ],
    });
    expect(igual.plano.fichas[0].anamnesis).toBe(
      '<h3>Queixa principal</h3><p>Dor.</p>',
    );
    expect(igual.plano.fichas[0].conduct).toBe('<h3>Plano</h3><p>RM.</p>');

    const diferente = planejar({
      ...base,
      pacientes_ai_summary: [
        {
          id: '1',
          paciente_id: '10',
          atendimento_id: 'a1',
          sys_active: '1',
          conteudo: '<h3>Plano</h3><p>Outro.</p>',
          data: '2025-01-10 09:30:00',
          sys_user: '0',
        },
      ],
    });
    expect(diferente.plano.fichas[0].conduct).toContain(
      'Resumo da consulta (gerado por IA no Feegow)',
    );
    expect(diferente.plano.fichas[0].conduct).toContain('<p>Outro.</p>');
  });

  it('resumo de IA sem atendimento vira ficha solta', () => {
    const { plano } = planejar({
      pacientes_ai_summary: [
        {
          id: '7',
          paciente_id: '10',
          atendimento_id: null,
          sys_active: '1',
          conteudo: IA,
          data: '2025-03-01 10:00:00',
          sys_user: '0',
        },
      ],
    });
    expect(plano.fichas).toHaveLength(1);
    expect(plano.fichas[0].appointmentId).toBeNull();
  });

  it('atestado emitido no Feegow vira ficha com o texto na conduta', () => {
    const { plano } = planejar({
      prescricao_atestados_diagnosticos_pedidosexames: [
        {
          tipo: 'Atestado',
          PacienteId: '10',
          conteudo: '<p>Atesto repouso.</p>',
          datahora: '2025-08-04 13:29:39',
          Usuario_ID: '999',
        },
      ],
    });
    expect(plano.fichas[0].conduct).toBe(
      '<h4>Atestado emitido no Feegow em 04/08/2025</h4><p>Atesto repouso.</p>',
    );
    expect(plano.fichas[0].doctorId).toBe(OWNER);
  });

  it('paciente não importado rejeita a ficha', () => {
    const { ctx, plano } = planejar({
      atendimentos: [atd('a1', { paciente_id: '98' })],
    });
    expect(plano.fichas).toHaveLength(0);
    expect(
      ctx.relatorio.rejeicoes.some(
        (r) => r.motivo === 'paciente não importado',
      ),
    ).toBe(true);
  });

  it('segunda rodada no mesmo ledger não duplica', () => {
    const tabelas = { atendimentos: [atd('a1')] };
    const primeira = planejar(tabelas);
    const exp = exportSintetico({
      agendamentos: AGENDAMENTOS,
      formularios: FORMULARIOS,
      ...tabelas,
    } as never);
    const segunda = planejarProntuario(
      exp,
      contextoDeTeste({ ledger: primeira.ctx.ledger }),
    );
    expect(segunda.fichas).toHaveLength(0);
  });

  it('--modelos-vazios: um modelo por formulário ativo da clínica, sem repetir nome', () => {
    const { plano } = planejar(
      {
        formularios: [
          ...FORMULARIOS,
          { id: '9', Nome: 'caixa  livre', sysActive: '1' },
        ],
      },
      { modelosVazios: true },
    );
    expect(plano.modelosVazios.map((m) => m.name)).toEqual([
      'Primeira Consulta',
      'Caixa Livre',
    ]);
    expect(planejar({}).plano.modelosVazios).toEqual([]);
  });

  it('gravar insere fichas e modelos', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ execute, orIgnore: jest.fn() });
    const into = jest.fn().mockReturnValue({ values });
    const manager = {
      createQueryBuilder: () => ({ insert: () => ({ into }) }),
    } as unknown as EntityManager;
    const { plano } = planejar(
      { atendimentos: [atd('a1')] },
      { modelosVazios: true },
    );

    await gravarProntuario(plano, manager);

    expect(into).toHaveBeenCalledWith(ClinicalRecord);
    expect(into).toHaveBeenCalledWith(ClinicalRecordTemplate);
  });
});
