import { QueryRunner } from 'typeorm';
import {
  CanonicalizeUserPhones1755802000000,
  IDX_USERS_PHONE_UNIQUE,
  SQL_CANONIZA_TELEFONES,
  SQL_INDICE_ANTERIOR,
  SQL_INDICE_CANONICO,
} from './migrations/1755802000000-CanonicalizeUserPhones';
import {
  TELEFONE_REPETIDO_APOS_CANONIZAR,
  VERIFICACOES_PRE_MIGRATION,
} from './preflight/data-checks';
import { telefoneCanonicoSql } from '../../shared/utils/phone.util';

describe('CanonicalizeUserPhones1755802000000', () => {
  function criarQueryRunner(conflitos: Record<string, unknown>[] = []) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql === TELEFONE_REPETIDO_APOS_CANONIZAR.sql ? conflitos : undefined,
      ),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }
  const executadas = (query: jest.Mock) =>
    query.mock.calls.map(([sql]) => sql as string);

  it('verifica, troca o índice e canoniza os telefones nessa ordem', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new CanonicalizeUserPhones1755802000000().up(queryRunner);

    expect(executadas(query)).toEqual([
      TELEFONE_REPETIDO_APOS_CANONIZAR.sql,
      `DROP INDEX IF EXISTS "${IDX_USERS_PHONE_UNIQUE}"`,
      SQL_CANONIZA_TELEFONES,
      SQL_INDICE_CANONICO,
    ]);
  });

  it('aborta antes de qualquer DDL quando dois usuários colidem após canonizar', async () => {
    const { queryRunner, query } = criarQueryRunner([
      { phone: '11987654321', ids: 'vitima, atacante' },
    ]);

    const erro = await new CanonicalizeUserPhones1755802000000()
      .up(queryRunner)
      .catch((e: Error) => e);

    expect(erro).toBeInstanceOf(Error);
    const mensagem = (erro as Error).message;
    expect(mensagem).toContain('vitima, atacante');
    expect(mensagem).not.toContain('11987654321');
    expect(mensagem).toContain('4321');
    expect(executadas(query)).toEqual([TELEFONE_REPETIDO_APOS_CANONIZAR.sql]);
  });

  it('o índice único é sobre o valor canônico e mantém o nome que o cadastro reconhece', () => {
    expect(IDX_USERS_PHONE_UNIQUE).toBe('IDX_users_phone_unique');
    expect(SQL_INDICE_CANONICO).toContain(
      `((${telefoneCanonicoSql('"phone"')}))`,
    );
    expect(SQL_INDICE_CANONICO).toContain(
      'WHERE "phone" IS NOT NULL AND "deleted_at" IS NULL',
    );
  });

  it('só reescreve usuários vivos cujo canônico é um telefone brasileiro válido', () => {
    expect(SQL_CANONIZA_TELEFONES).toContain('"deleted_at" IS NULL');
    expect(SQL_CANONIZA_TELEFONES).toContain(
      "~ '^[1-9]{2}(9[0-9]{8}|[2-5][0-9]{7})$'",
    );
    expect(SQL_CANONIZA_TELEFONES).toContain(
      `"phone" <> ${telefoneCanonicoSql('"phone"')}`,
    );
  });

  it('down volta o índice simples sobre a coluna', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new CanonicalizeUserPhones1755802000000().down(queryRunner);

    expect(executadas(query)).toEqual([
      `DROP INDEX IF EXISTS "${IDX_USERS_PHONE_UNIQUE}"`,
      SQL_INDICE_ANTERIOR,
    ]);
    expect(SQL_INDICE_ANTERIOR).toContain('ON "users" ("phone")');
  });

  it('a verificação aponta para esta migration e roda no pré-flight', () => {
    expect(TELEFONE_REPETIDO_APOS_CANONIZAR.migration).toBe(
      new CanonicalizeUserPhones1755802000000().name,
    );
    expect(VERIFICACOES_PRE_MIGRATION).toContain(
      TELEFONE_REPETIDO_APOS_CANONIZAR,
    );
  });
});

describe('TELEFONE_REPETIDO_APOS_CANONIZAR', () => {
  it('é read-only', () => {
    expect(TELEFONE_REPETIDO_APOS_CANONIZAR.sql).toMatch(/^\s*SELECT/i);
    expect(TELEFONE_REPETIDO_APOS_CANONIZAR.sql).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i,
    );
  });

  it('agrupa pelo canônico só entre usuários vivos', () => {
    const sql = TELEFONE_REPETIDO_APOS_CANONIZAR.sql;
    expect(sql).toContain(telefoneCanonicoSql('u."phone"'));
    expect(sql).toContain('deleted_at" IS NULL');
    expect(sql).toContain('GROUP BY c.canonico');
    expect(sql).toContain('HAVING count(*) > 1');
  });

  it('mascara o telefone e preserva os ids', () => {
    const conflitos = TELEFONE_REPETIDO_APOS_CANONIZAR.mapear([
      { phone: '11987654321', ids: 'id-a, id-b' },
    ]);

    expect(conflitos).toHaveLength(1);
    expect(conflitos[0].ids).toBe('id-a, id-b');
    expect(conflitos[0].chave).not.toContain('11987654321');
    expect(conflitos[0].chave).toContain('4321');
  });
});
