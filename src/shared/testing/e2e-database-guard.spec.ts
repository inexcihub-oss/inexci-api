import {
  assertBancoDeTeste,
  comBancoDeTeste,
  nomeDoBancoDeTeste,
  sqlTabelasParaTruncar,
  TABELAS_PRESERVADAS_NO_TRUNCATE,
} from './e2e-database-guard';

describe('proteção do banco nos testes e2e', () => {
  const ORIGINAL = process.env.TEST_DB_NAME;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.TEST_DB_NAME;
    else process.env.TEST_DB_NAME = ORIGINAL;
  });

  describe('comBancoDeTeste', () => {
    it('redireciona a connection string de desenvolvimento', () => {
      expect(
        comBancoDeTeste('postgresql://inexci:senha@localhost:5432/inexci'),
      ).toContain('/inexci_test');
    });

    it('preserva credenciais, host, porta e query string', () => {
      const url = new URL(
        comBancoDeTeste(
          'postgresql://usuario:s3nh4@db.interno:6543/inexci?sslmode=require',
        ),
      );
      expect(url.username).toBe('usuario');
      expect(url.password).toBe('s3nh4');
      expect(url.hostname).toBe('db.interno');
      expect(url.port).toBe('6543');
      expect(url.pathname).toBe('/inexci_test');
      expect(url.searchParams.get('sslmode')).toBe('require');
    });

    it('respeita TEST_DB_NAME', () => {
      process.env.TEST_DB_NAME = 'outro_banco_de_teste';
      expect(
        comBancoDeTeste('postgresql://inexci:senha@localhost:5432/inexci'),
      ).toContain('/outro_banco_de_teste');
      expect(nomeDoBancoDeTeste()).toBe('outro_banco_de_teste');
    });

    it('é idempotente', () => {
      const uma = comBancoDeTeste('postgresql://a:b@h:5432/inexci');
      expect(comBancoDeTeste(uma)).toBe(uma);
    });
  });

  describe('assertBancoDeTeste', () => {
    /**
     * O motivo desta proteção existir: rodar a suíte e2e apontada para o banco
     * de desenvolvimento truncou todas as tabelas e apagou o trabalho local.
     */
    it('recusa quando o banco conectado não é o de teste', async () => {
      const query = jest
        .fn()
        .mockResolvedValue([{ current_database: 'inexci' }]);

      await expect(assertBancoDeTeste({ query })).rejects.toThrow(
        /Recusando limpar o banco "inexci"/,
      );
    });

    it('aponta o caminho da correção na mensagem', async () => {
      const query = jest
        .fn()
        .mockResolvedValue([{ current_database: 'producao' }]);

      await expect(assertBancoDeTeste({ query })).rejects.toThrow(
        /yarn test:e2e:prepare/,
      );
    });

    it('deixa passar quando o banco é o de teste', async () => {
      const query = jest
        .fn()
        .mockResolvedValue([{ current_database: 'inexci_test' }]);

      await expect(assertBancoDeTeste({ query })).resolves.toBeUndefined();
    });

    it('recusa quando a consulta não devolve nada (fail-closed)', async () => {
      const query = jest.fn().mockResolvedValue([]);

      await expect(assertBancoDeTeste({ query })).rejects.toThrow(
        /Recusando limpar/,
      );
    });
  });
  describe('tabelas preservadas no TRUNCATE', () => {
    // `subscription_plans` é catálogo semeado pela migration CreateBilling, não
    // dado de tenant. Truncá-la deixa o trial do register sem plano e faz todo
    // `POST /surgery-requests/:id/send` responder 404 "Assinatura não
    // encontrada" — sintoma longe demais da causa para ser diagnosticado rápido.
    it('preserva migrations e subscription_plans', () => {
      expect(TABELAS_PRESERVADAS_NO_TRUNCATE).toEqual(
        expect.arrayContaining(['migrations', 'subscription_plans']),
      );
    });

    it('exclui todas as tabelas preservadas do SQL de listagem', () => {
      const sql = sqlTabelasParaTruncar();

      for (const tabela of TABELAS_PRESERVADAS_NO_TRUNCATE) {
        expect(sql).toContain(`'${tabela}'`);
      }
      expect(sql).toMatch(/NOT IN \(/);
      expect(sql).toContain("schemaname = 'public'");
    });
  });
});
