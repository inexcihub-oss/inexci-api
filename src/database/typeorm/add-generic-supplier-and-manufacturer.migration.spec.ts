import * as fs from 'fs';
import * as path from 'path';
import { QueryRunner } from 'typeorm';
import { AddGenericSupplierAndManufacturer1755700200000 } from './migrations/1755700200000-AddGenericSupplierAndManufacturer';

describe('AddGenericSupplierAndManufacturer1755700200000', () => {
  const SQL_VERIFICACAO = "IN ('outro', 'outros')";

  type LinhaLegada = { tipo: string; nome: string; ids: string };

  function criarQueryRunner(legadas: LinhaLegada[]) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.trimStart().startsWith('SELECT') ? legadas : undefined,
      ),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }

  const executadas = (query: jest.Mock) =>
    query.mock.calls.map(([sql]) => sql as string);

  async function rodarUp(legadas: LinhaLegada[] = []) {
    const { queryRunner, query } = criarQueryRunner(legadas);
    await new AddGenericSupplierAndManufacturer1755700200000().up(queryRunner);
    return executadas(query);
  }

  describe('em banco limpo', () => {
    it('cria a coluna nas duas tabelas', async () => {
      const sqls = await rodarUp();

      expect(
        sqls.filter((sql) => /ALTER TABLE .+ADD COLUMN/i.test(sql)),
      ).toHaveLength(2);
    });

    it('cria o índice único do genérico nas duas tabelas', async () => {
      const sqls = await rodarUp();

      expect(
        sqls.filter((sql) => /CREATE UNIQUE INDEX/i.test(sql)),
      ).toHaveLength(2);
    });
  });

  describe('idempotência', () => {
    it('não falha contra schema que já existe', async () => {
      const sqls = await rodarUp();

      sqls
        .filter((sql) => /ALTER TABLE|CREATE UNIQUE INDEX/i.test(sql))
        .forEach((sql) => expect(sql).toMatch(/IF NOT EXISTS/i));
    });

    it('down também tolera schema já removido', async () => {
      const { queryRunner, query } = criarQueryRunner([]);

      await new AddGenericSupplierAndManufacturer1755700200000().down(
        queryRunner,
      );

      executadas(query).forEach((sql) => expect(sql).toMatch(/IF EXISTS/i));
    });
  });

  describe('fusão de dados', () => {
    it('não altera nem apaga linha nenhuma', async () => {
      const sqls = await rodarUp();

      sqls.forEach((sql) =>
        expect(sql).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO)\b/i),
      );
    });
  });

  describe('dado legado não unificado', () => {
    const legada = { tipo: 'supplier', nome: 'Outros', ids: 'id-a, id-b' };

    it('aborta antes de encostar no schema', async () => {
      const { queryRunner, query } = criarQueryRunner([legada]);

      await expect(
        new AddGenericSupplierAndManufacturer1755700200000().up(queryRunner),
      ).rejects.toThrow(/outro/i);

      expect(
        executadas(query).some((sql) =>
          /ALTER TABLE|CREATE UNIQUE INDEX/i.test(sql),
        ),
      ).toBe(false);
    });

    it('diz quais linhas travam e como destravar', async () => {
      const { queryRunner } = criarQueryRunner([legada]);

      const erro = await new AddGenericSupplierAndManufacturer1755700200000()
        .up(queryRunner)
        .catch((e: Error) => e);

      expect((erro as Error).message).toContain('id-a, id-b');
      expect((erro as Error).message).toMatch(/outro-generico-aplicar\.sql/);
    });

    it('procura as duas grafias, singular e plural', async () => {
      const { queryRunner, query } = criarQueryRunner([]);

      await new AddGenericSupplierAndManufacturer1755700200000().up(
        queryRunner,
      );

      const consulta = executadas(query).find((sql) =>
        sql.includes(SQL_VERIFICACAO),
      );
      expect(consulta).toBeDefined();
    });
  });
});

describe('scripts/sql/outro-generico-aplicar.sql', () => {
  const DIR_SQL = path.join(__dirname, '..', '..', '..', 'scripts', 'sql');
  const aplicar = () =>
    fs.readFileSync(path.join(DIR_SQL, 'outro-generico-aplicar.sql'), 'utf-8');
  const conferencia = () =>
    fs.readFileSync(
      path.join(DIR_SQL, 'outro-generico-conferencia.sql'),
      'utf-8',
    );

  const NOMES_DE_SCHEMA = [
    'is_generic',
    'uq_suppliers_owner_generic',
    'uq_manufacturers_owner_generic',
  ];

  it('usa os mesmos nomes de coluna e índice que a migration', () => {
    const arquivoDaMigration = fs.readFileSync(
      path.join(
        __dirname,
        'migrations',
        '1755700200000-AddGenericSupplierAndManufacturer.ts',
      ),
      'utf-8',
    );

    NOMES_DE_SCHEMA.forEach((nome) => {
      expect(aplicar()).toContain(nome);
      expect(arquivoDaMigration).toContain(nome);
    });
  });

  it('registra a migration como aplicada, com o nome exato da classe', () => {
    expect(aplicar()).toContain('INSERT INTO "migrations"');
    expect(aplicar()).toContain(
      'AddGenericSupplierAndManufacturer1755700200000',
    );
    expect(aplicar()).toContain('1755700200000');
  });

  it('roda dentro de uma transação', () => {
    expect(aplicar()).toMatch(/^\s*BEGIN;/m);
    expect(aplicar()).toMatch(/^\s*COMMIT;/m);
  });

  it('é reexecutável: todo DDL é condicional', () => {
    const ddl = aplicar()
      .split('\n')
      .filter((linha) => /ALTER TABLE|CREATE UNIQUE INDEX/i.test(linha));

    expect(ddl.length).toBeGreaterThan(0);
    ddl.forEach((linha) => expect(linha).toMatch(/IF NOT EXISTS/i));
  });

  it('aborta se achar cadastro de verdade chamado "Outro"', () => {
    expect(aplicar()).toContain('RAISE EXCEPTION');
    expect(aplicar()).toMatch(/cnpj/i);
  });

  it('a conferência é read-only', () => {
    expect(conferencia()).not.toMatch(
      /\b(INSERT INTO|UPDATE |DELETE FROM|DROP |ALTER |CREATE )/i,
    );
  });
});
