import { LEDGER_PROFISSIONAL } from './team.mapper';
import { contextoDeTeste, exportSintetico } from '../testing/export-sintetico';
import {
  cortarSemPartirMarcador,
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

describe('cortarSemPartirMarcador', () => {
  it('corte no meio de um marcador recua até antes do {{', () => {
    expect(
      cortarSemPartirMarcador('Atesto que {{paciente.nome}} veio', 24),
    ).toBe('Atesto que ');
  });

  it('corte fora de marcador fica como está', () => {
    expect(cortarSemPartirMarcador('{{paciente.nome}} veio hoje', 22)).toBe(
      '{{paciente.nome}} veio',
    );
    expect(cortarSemPartirMarcador('texto curto', 100)).toBe('texto curto');
  });

  it('corte logo depois do }} mantém o marcador inteiro', () => {
    expect(cortarSemPartirMarcador('a {{data}} b', 10)).toBe('a {{data}}');
  });
});

describe('planejarModelosDeDocumento — corpo longo', () => {
  it('corta em 2000 sem deixar marcador partido', () => {
    const ctx = contextoDeTeste();
    const texto = `${'x'.repeat(1990)} [Paciente.Nome] fim`;
    const exp = exportSintetico({
      modelos_atestados: [
        {
          id: '1',
          nome_modelo_atestado: 'Longo',
          texto_modelo_atestado: texto,
          is_active: '1',
        },
      ],
    });
    const [modelo] = planejarModelosDeDocumento(exp, ctx);
    expect(modelo.body.length).toBeLessThanOrEqual(2000);
    expect(modelo.body).not.toContain('{{');
    expect(modelo.body.trimEnd()).toBe('x'.repeat(1990));
  });
});
