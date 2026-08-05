import * as fs from 'fs';
import * as path from 'path';
import { QueryRunner } from 'typeorm';
import { AddUniqueIndexUserPhone1752300900000 } from './migrations/1752300900000-AddUniqueIndexUserPhone';

/**
 * Este spec mora FORA de `migrations/` de propósito: o `data-source.ts` carrega
 * `migrations/*.{ts,js}` inteiro, então um `.spec.ts` ali dentro é importado
 * pelo CLI do TypeORM e derruba o `migration:run` com `describe is not defined`
 * — no deploy, não no `yarn test`.
 */
describe('diretório de migrations', () => {
  it('não contém arquivos de teste (o glob do data-source carrega tudo)', () => {
    const dir = path.join(__dirname, 'migrations');
    const suspeitos = fs
      .readdirSync(dir)
      .filter((f) => /\.(spec|test)\.(ts|js)$/.test(f));

    expect(suspeitos).toEqual([]);
  });
});

/**
 * O `CREATE UNIQUE INDEX` quebra em qualquer banco que já tenha telefone
 * repetido — foi o que aconteceu no deploy de produção, e o erro do Postgres
 * (`could not create unique index`, `Key (phone)=(...) is duplicated`) não diz
 * quais contas estão em conflito nem o que fazer. A migration passa a olhar o
 * dado antes e abortar com diagnóstico acionável.
 */
describe('AddUniqueIndexUserPhone1752300900000', () => {
  const SQL_DUPLICADOS = 'HAVING count(*) > 1';
  const SQL_CRIA_INDICE = 'CREATE UNIQUE INDEX';

  type LinhaDuplicada = { phone: string; ids: string };

  function criarQueryRunner(duplicados: LinhaDuplicada[]) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(sql.includes(SQL_DUPLICADOS) ? duplicados : undefined),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }

  const executadas = (query: jest.Mock) =>
    query.mock.calls.map(([sql]) => sql as string);

  it('cria o índice quando não há telefone duplicado', async () => {
    const { queryRunner, query } = criarQueryRunner([]);

    await new AddUniqueIndexUserPhone1752300900000().up(queryRunner);

    expect(executadas(query).some((sql) => sql.includes(SQL_CRIA_INDICE))).toBe(
      true,
    );
  });

  it('aborta sem criar o índice quando há telefone duplicado', async () => {
    const { queryRunner, query } = criarQueryRunner([
      { phone: '21995953689', ids: 'id-a, id-b' },
    ]);

    await expect(
      new AddUniqueIndexUserPhone1752300900000().up(queryRunner),
    ).rejects.toThrow(/telefone/i);

    expect(executadas(query).some((sql) => sql.includes(SQL_CRIA_INDICE))).toBe(
      false,
    );
  });

  it('lista os ids em conflito e mascara o telefone na mensagem', async () => {
    const { queryRunner } = criarQueryRunner([
      { phone: '21995953689', ids: 'id-a, id-b' },
    ]);

    const erro = await new AddUniqueIndexUserPhone1752300900000()
      .up(queryRunner)
      .catch((e: Error) => e);

    const mensagem = (erro as Error).message;
    expect(mensagem).toContain('id-a, id-b');
    // Telefone mascarado: o log de deploy não é lugar para PII completa.
    expect(mensagem).not.toContain('21995953689');
    expect(mensagem).toContain('89');
  });

  it('reporta todos os telefones em conflito, não só o primeiro', async () => {
    const { queryRunner } = criarQueryRunner([
      { phone: '21995953689', ids: 'id-a, id-b' },
      { phone: '11988887777', ids: 'id-c, id-d' },
    ]);

    const erro = await new AddUniqueIndexUserPhone1752300900000()
      .up(queryRunner)
      .catch((e: Error) => e);

    expect((erro as Error).message).toContain('id-a, id-b');
    expect((erro as Error).message).toContain('id-c, id-d');
  });

  it('só considera duplicata entre usuários vivos', async () => {
    const { queryRunner, query } = criarQueryRunner([]);

    await new AddUniqueIndexUserPhone1752300900000().up(queryRunner);

    const consulta = executadas(query).find((sql) =>
      sql.includes(SQL_DUPLICADOS),
    );
    expect(consulta).toContain('deleted_at" IS NULL');
    expect(consulta).toContain('phone" IS NOT NULL');
  });

  it('down remove o índice', async () => {
    const { queryRunner, query } = criarQueryRunner([]);

    await new AddUniqueIndexUserPhone1752300900000().down(queryRunner);

    expect(executadas(query).some((sql) => sql.includes('DROP INDEX'))).toBe(
      true,
    );
  });
});
