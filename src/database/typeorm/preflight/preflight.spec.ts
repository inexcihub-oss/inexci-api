import { VerificacaoPreMigration } from './data-checks';
import { rodarPreflight } from './preflight';

describe('rodarPreflight', () => {
  const VERIFICACAO: VerificacaoPreMigration = {
    migration: 'MigrationFicticia1000000000000',
    descricao: 'telefone repetido',
    sql: 'SELECT 1',
    comoResolver: 'resolva o conflito',
    mapear: (linhas) =>
      linhas.map((l) => ({ chave: String(l.chave), ids: String(l.ids) })),
  };

  const consultarVazio = jest.fn().mockResolvedValue([]);

  it('aprova quando não há conflito', async () => {
    const resultado = await rodarPreflight({
      aplicadas: async () => [],
      consultar: consultarVazio,
      verificacoes: [VERIFICACAO],
    });

    expect(resultado.aprovado).toBe(true);
    expect(resultado.diagnosticos).toEqual([]);
  });

  it('reprova e devolve o diagnóstico quando há conflito', async () => {
    const resultado = await rodarPreflight({
      aplicadas: async () => [],
      consultar: async () => [{ chave: '*******3689', ids: 'id-a, id-b' }],
      verificacoes: [VERIFICACAO],
    });

    expect(resultado.aprovado).toBe(false);
    expect(resultado.diagnosticos).toHaveLength(1);
    expect(resultado.diagnosticos[0]).toContain('id-a, id-b');
  });

  it('pula verificação de migration já aplicada', async () => {
    const consultar = jest.fn().mockResolvedValue([]);

    const resultado = await rodarPreflight({
      aplicadas: async () => [VERIFICACAO.migration],
      consultar,
      verificacoes: [VERIFICACAO],
    });

    // Rodar a checagem de uma migration já aplicada acusaria um conflito que o
    // banco, por definição, não tem mais — e travaria deploy por nada.
    expect(consultar).not.toHaveBeenCalled();
    expect(resultado.aprovado).toBe(true);
    expect(resultado.puladas).toContain(VERIFICACAO.migration);
  });

  it('verifica todas as pendentes, não para na primeira que falha', async () => {
    const outra: VerificacaoPreMigration = {
      ...VERIFICACAO,
      migration: 'OutraMigration2000000000000',
    };

    const resultado = await rodarPreflight({
      aplicadas: async () => [],
      consultar: async () => [{ chave: 'x', ids: 'id-z' }],
      verificacoes: [VERIFICACAO, outra],
    });

    expect(resultado.diagnosticos).toHaveLength(2);
  });

  it('propaga falha de consulta como reprovação, não como sucesso', async () => {
    const resultado = await rodarPreflight({
      aplicadas: async () => [],
      consultar: async () => {
        throw new Error('conexão recusada');
      },
      verificacoes: [VERIFICACAO],
    });

    expect(resultado.aprovado).toBe(false);
    expect(resultado.diagnosticos.join('\n')).toContain('conexão recusada');
  });
});
