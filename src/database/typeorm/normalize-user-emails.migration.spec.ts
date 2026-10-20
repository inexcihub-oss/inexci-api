import { QueryRunner } from 'typeorm';
import {
  NormalizeUserEmailsLowercase1755802237000,
  SQL_INDICE_EMAIL_LOWER,
  SQL_NORMALIZA_EMAILS,
  SQL_REMOVE_UNIQUE_ANTERIOR,
  UQ_USERS_EMAIL_LOWER,
} from './migrations/1755802237000-NormalizeUserEmailsLowercase';
import {
  EMAIL_REPETIDO_SEM_MAIUSCULAS,
  VERIFICACOES_PRE_MIGRATION,
} from './preflight/data-checks';
import { USER_EMAIL_UNICO } from '../entities/user.entity';

describe('NormalizeUserEmailsLowercase1755802237000', () => {
  function criarQueryRunner(conflitos: Record<string, unknown>[] = []) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql === EMAIL_REPETIDO_SEM_MAIUSCULAS.sql ? conflitos : undefined,
      ),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }
  const executadas = (query: jest.Mock) =>
    query.mock.calls.map(([sql]) => sql as string);

  it('verifica, normaliza, troca o unique e cria o índice em lower(email) nessa ordem', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new NormalizeUserEmailsLowercase1755802237000().up(queryRunner);

    expect(executadas(query)).toEqual([
      EMAIL_REPETIDO_SEM_MAIUSCULAS.sql,
      SQL_NORMALIZA_EMAILS,
      SQL_REMOVE_UNIQUE_ANTERIOR,
      SQL_INDICE_EMAIL_LOWER,
    ]);
  });

  it('aborta antes de qualquer escrita quando dois usuários colidem sem maiúsculas, sem expor o e-mail', async () => {
    const { queryRunner, query } = criarQueryRunner([
      { email: 'fulano@exemplo.com', ids: 'id-a, id-b' },
    ]);

    const erro = await new NormalizeUserEmailsLowercase1755802237000()
      .up(queryRunner)
      .catch((e: Error) => e);

    expect(erro).toBeInstanceOf(Error);
    const mensagem = (erro as Error).message;
    expect(mensagem).toContain('id-a, id-b');
    expect(mensagem).not.toContain('fulano@exemplo.com');
    expect(executadas(query)).toEqual([EMAIL_REPETIDO_SEM_MAIUSCULAS.sql]);
  });

  it('a verificação é read-only, olha todas as linhas e entra no preflight', () => {
    expect(EMAIL_REPETIDO_SEM_MAIUSCULAS.sql).toMatch(/^\s*SELECT/i);
    expect(EMAIL_REPETIDO_SEM_MAIUSCULAS.sql).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i,
    );
    expect(EMAIL_REPETIDO_SEM_MAIUSCULAS.sql).toContain(
      'lower(btrim(u."email"))',
    );
    expect(EMAIL_REPETIDO_SEM_MAIUSCULAS.sql).not.toContain('deleted_at');
    expect(VERIFICACOES_PRE_MIGRATION).toContain(EMAIL_REPETIDO_SEM_MAIUSCULAS);
  });

  it('o índice é único em lower(email) e tem o nome declarado na entity', () => {
    expect(UQ_USERS_EMAIL_LOWER).toBe(USER_EMAIL_UNICO);
    expect(SQL_INDICE_EMAIL_LOWER).toContain('CREATE UNIQUE INDEX');
    expect(SQL_INDICE_EMAIL_LOWER).toContain('(lower("email"))');
    expect(SQL_NORMALIZA_EMAILS).toContain('lower(btrim("email"))');
  });

  it('down volta ao unique original sobre email', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new NormalizeUserEmailsLowercase1755802237000().down(queryRunner);

    expect(executadas(query)).toEqual([
      `DROP INDEX IF EXISTS "${UQ_USERS_EMAIL_LOWER}"`,
      `ALTER TABLE "users" ADD CONSTRAINT "uq_users_email" UNIQUE ("email")`,
    ]);
  });
});
