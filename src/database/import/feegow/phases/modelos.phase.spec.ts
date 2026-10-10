import { EntityManager } from 'typeorm';
import { ClinicalDocumentTemplate } from 'src/database/entities/clinical-document-template.entity';
import {
  converterMarcadores,
  LEDGER_MODELO_DOCUMENTO,
} from '../mappers/doc-template.mapper';
import { LEDGER_PROFISSIONAL } from '../mappers/team.mapper';
import {
  contextoDeTeste,
  exportSintetico,
  OWNER,
} from '../testing/export-sintetico';
import { gravarModelos, planejarModelos } from './modelos.phase';

function atestado(id: string, extra: object = {}) {
  return {
    id,
    nome_modelo_atestado: 'Atestado Médico',
    titulo_modelo_atestado: null,
    texto_modelo_atestado:
      '<p>Atesto que [Paciente.Nome] (CPF [Paciente.CPF])&nbsp;esteve em consulta em [Data].</p><p>[Profissional.Nome] [Outro.Campo]</p>',
    is_active: '1',
    usuario_insercao_id: '173',
    ...extra,
  };
}

function planejar(tabelas: Record<string, unknown[]>) {
  const ctx = contextoDeTeste();
  ctx.ledger.registrar(LEDGER_PROFISSIONAL, '1', 'medico-1');
  const exp = exportSintetico({
    usuarios: [{ id: '173', tipo_usuario: 'Profissionais', id_relativo: '1' }],
    ...tabelas,
  });
  return { ctx, plano: planejarModelos(exp, ctx) };
}

describe('converterMarcadores', () => {
  it('converte os marcadores conhecidos e deixa os outros', () => {
    expect(
      converterMarcadores('[Paciente.Nome] [paciente.cpf] [Data] [X.Y]'),
    ).toBe('{{paciente.nome}} {{paciente.cpf}} {{data}} [X.Y]');
  });
});

describe('planejarModelos', () => {
  it('atestado vira texto puro com placeholders, no nome do profissional que criou', () => {
    const { ctx, plano } = planejar({ modelos_atestados: [atestado('1')] });
    expect(plano.modelos).toEqual([
      {
        id: expect.any(String),
        ownerId: OWNER,
        doctorId: 'medico-1',
        kind: 'medical_certificate',
        name: 'Atestado Médico',
        body: 'Atesto que {{paciente.nome}} (CPF {{paciente.cpf}}) esteve em consulta em {{data}}.\n{{medico.nome}} [Outro.Campo]',
      },
    ]);
    expect(ctx.ledger.resolver(LEDGER_MODELO_DOCUMENTO, 'atestado:1')).toBe(
      plano.modelos[0].id,
    );
  });

  it('inativo fica de fora; ativo sem texto é rejeitado', () => {
    const { ctx, plano } = planejar({
      modelos_atestados: [
        atestado('1', { is_active: '0' }),
        atestado('2', { texto_modelo_atestado: '<p>&nbsp;</p>' }),
      ],
    });
    expect(plano.modelos).toHaveLength(0);
    expect(ctx.relatorio.rejeicoes.map((r) => r.idOrigem)).toEqual([
      'atestado:2',
    ]);
  });

  it('pedido de exame vira exam_referral; criador desconhecido → dono; sem nome usa o padrão', () => {
    const { plano } = planejar({
      modelos_pedidosexame: [
        {
          id: '1',
          nome_modelo_pedido_exame: null,
          texto_pedido_exame: 'Solicito RM',
          is_active: '1',
          usuario_insercao_id: '999',
        },
      ],
    });
    expect(plano.modelos[0]).toMatchObject({
      kind: 'exam_referral',
      doctorId: OWNER,
      name: 'Pedido de exame (Feegow)',
      body: 'Solicito RM',
    });
  });

  it('texto acima de 2000 caracteres é cortado com aviso', () => {
    const { ctx, plano } = planejar({
      modelos_atestados: [
        atestado('1', { texto_modelo_atestado: 'a'.repeat(2500) }),
      ],
    });
    expect(plano.modelos[0].body).toHaveLength(2000);
    expect(ctx.relatorio.avisos[0].aviso).toContain('cortado');
  });

  it('gravar insere em ClinicalDocumentTemplate', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ execute, orIgnore: jest.fn() });
    const into = jest.fn().mockReturnValue({ values });
    const manager = {
      createQueryBuilder: () => ({ insert: () => ({ into }) }),
    } as unknown as EntityManager;
    const { plano } = planejar({ modelos_atestados: [atestado('1')] });

    await gravarModelos(plano, manager);

    expect(into).toHaveBeenCalledWith(ClinicalDocumentTemplate);
  });
});
