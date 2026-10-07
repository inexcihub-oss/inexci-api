import { LEDGER_PROFISSIONAL } from './team.mapper';
import { contextoDeTeste, exportSintetico } from '../testing/export-sintetico';
import {
  marcadoresDesconhecidos,
  planejarModelosDeDocumento,
} from './doc-template.mapper';

describe('marcadoresDesconhecidos', () => {
  it('lista, sem repetir, só os marcadores do Feegow sem equivalente', () => {
    expect(
      marcadoresDesconhecidos(
        '[Paciente.Nome] [Paciente.Endereco] [X] [Data] [Paciente.Endereco] [Convenio.Nome]',
      ),
    ).toEqual(['[Paciente.Endereco]', '[Convenio.Nome]']);
  });
});

describe('planejarModelosDeDocumento — marcadores desconhecidos', () => {
  it('avisa no relatório, por modelo, os marcadores que ficaram como texto', () => {
    const ctx = contextoDeTeste();
    ctx.ledger.registrar(LEDGER_PROFISSIONAL, '1', 'medico-1');
    const exp = exportSintetico({
      modelos_atestados: [
        {
          id: '1',
          nome_modelo_atestado: 'Atestado',
          texto_modelo_atestado:
            '<p>[Paciente.Nome] mora em [Paciente.Endereco], convênio [Convenio.Nome].</p>',
          is_active: '1',
        },
        {
          id: '2',
          nome_modelo_atestado: 'Limpo',
          texto_modelo_atestado: '<p>Atesto que [Paciente.Nome] [X].</p>',
          is_active: '1',
        },
      ],
    });
    const modelos = planejarModelosDeDocumento(exp, ctx);
    expect(modelos).toHaveLength(2);
    expect(modelos[0].body).toContain('[Paciente.Endereco]');
    expect(ctx.relatorio.avisos).toEqual([
      {
        entidade: 'modelo de documento',
        idOrigem: 'atestado:1',
        aviso:
          'marcadores do Feegow sem equivalente ficaram como texto: revise o modelo',
        detalhe: '[Paciente.Endereco], [Convenio.Nome]',
      },
    ]);
  });
});
