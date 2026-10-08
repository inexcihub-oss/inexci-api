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

  describe('schema criado por migration pendente do mesmo deploy', () => {
    const erroPg = (code: string, message: string) =>
      Object.assign(new Error(message), { code });

    it('tabela ainda inexistente (42P01) adia a checagem, sem reprovar', async () => {
      const resultado = await rodarPreflight({
        aplicadas: async () => [],
        consultar: async () => {
          throw erroPg('42P01', 'relation "clinic_rooms" does not exist');
        },
        verificacoes: [VERIFICACAO],
      });

      expect(resultado.aprovado).toBe(true);
      expect(resultado.diagnosticos).toEqual([]);
      expect(resultado.adiadas.join('\n')).toContain('clinic_rooms');
    });

    it('coluna ainda inexistente (42703) também adia, inclusive vinda do TypeORM', async () => {
      const resultado = await rodarPreflight({
        aplicadas: async () => [],
        consultar: async () => {
          throw Object.assign(new Error('QueryFailedError'), {
            driverError: { code: '42703' },
          });
        },
        verificacoes: [VERIFICACAO],
      });

      expect(resultado.aprovado).toBe(true);
      expect(resultado.adiadas).toHaveLength(1);
    });

    it('com sqlAntesDoSchema, confere o dado legado na hora e reprova se houver conflito', async () => {
      const consultar = jest.fn(async (sql: string) => {
        if (sql === 'SELECT 1')
          throw erroPg('42703', 'column a.is_walk_in does not exist');
        return [{ chave: 'médico x', ids: 'id-a, id-b' }];
      });

      const resultado = await rodarPreflight({
        aplicadas: async () => [],
        consultar,
        verificacoes: [{ ...VERIFICACAO, sqlAntesDoSchema: 'SELECT 2' }],
      });

      expect(consultar).toHaveBeenCalledWith('SELECT 2');
      expect(resultado.aprovado).toBe(false);
      expect(resultado.diagnosticos[0]).toContain('id-a, id-b');
      expect(resultado.adiadas).toEqual([]);
    });

    it('com sqlAntesDoSchema e sem conflito, aprova sem adiar', async () => {
      const resultado = await rodarPreflight({
        aplicadas: async () => [],
        consultar: async (sql: string) => {
          if (sql === 'SELECT 1') throw erroPg('42703', 'sem coluna');
          return [];
        },
        verificacoes: [{ ...VERIFICACAO, sqlAntesDoSchema: 'SELECT 2' }],
      });

      expect(resultado.aprovado).toBe(true);
      expect(resultado.adiadas).toEqual([]);
    });

    it('falha da versão alternativa continua reprovando', async () => {
      const resultado = await rodarPreflight({
        aplicadas: async () => [],
        consultar: async (sql: string) => {
          if (sql === 'SELECT 1') throw erroPg('42703', 'sem coluna');
          throw new Error('conexão recusada');
        },
        verificacoes: [{ ...VERIFICACAO, sqlAntesDoSchema: 'SELECT 2' }],
      });

      expect(resultado.aprovado).toBe(false);
      expect(resultado.diagnosticos.join('\n')).toContain('conexão recusada');
    });

    it('outros erros de banco (ex.: permissão) continuam reprovando', async () => {
      const resultado = await rodarPreflight({
        aplicadas: async () => [],
        consultar: async () => {
          throw erroPg('42501', 'permission denied for table users');
        },
        verificacoes: [VERIFICACAO],
      });

      expect(resultado.aprovado).toBe(false);
      expect(resultado.adiadas).toEqual([]);
    });
  });
});
