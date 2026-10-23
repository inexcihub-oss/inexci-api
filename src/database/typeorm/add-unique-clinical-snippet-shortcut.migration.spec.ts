import { QueryRunner } from 'typeorm';
import {
  AddUniqueClinicalSnippetShortcut1761000700000,
  UQ_CLINICAL_SNIPPETS_DOCTOR_SHORTCUT,
} from './migrations/1761000700000-AddUniqueClinicalSnippetShortcut';
import {
  TEXTO_RAPIDO_COM_ATALHO_REPETIDO,
  VERIFICACOES_PRE_MIGRATION,
} from './preflight/data-checks';
import { SNIPPET_ATALHO_UNICO } from '../entities/clinical-snippet.entity';

describe('AddUniqueClinicalSnippetShortcut1761000700000', () => {
  function criarQueryRunner(conflitos: Record<string, unknown>[] = []) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql === TEXTO_RAPIDO_COM_ATALHO_REPETIDO.sql ? conflitos : undefined,
      ),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }
  const executadas = (query: jest.Mock) =>
    query.mock.calls.map(([sql]) => sql as string);

  it('verifica o dado e cria o índice parcial por médico e atalho', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new AddUniqueClinicalSnippetShortcut1761000700000().up(queryRunner);

    expect(executadas(query)).toEqual([
      TEXTO_RAPIDO_COM_ATALHO_REPETIDO.sql,
      `CREATE UNIQUE INDEX "${UQ_CLINICAL_SNIPPETS_DOCTOR_SHORTCUT}" ON "clinical_snippets" ("doctor_id", "shortcut") WHERE "deleted_at" IS NULL`,
    ]);
  });

  it('aborta com diagnóstico sem criar índice quando há atalho repetido', async () => {
    const { queryRunner, query } = criarQueryRunner([
      { doctor_id: 'd1', atalho: 'normal', ids: 's-1, s-2' },
    ]);

    await expect(
      new AddUniqueClinicalSnippetShortcut1761000700000().up(queryRunner),
    ).rejects.toThrow(/médico d1: \/normal -> s-1, s-2/);
    expect(executadas(query)).toEqual([TEXTO_RAPIDO_COM_ATALHO_REPETIDO.sql]);
  });

  it('a verificação aponta para esta migration e roda no pré-flight', () => {
    expect(TEXTO_RAPIDO_COM_ATALHO_REPETIDO.migration).toBe(
      new AddUniqueClinicalSnippetShortcut1761000700000().name,
    );
    expect(VERIFICACOES_PRE_MIGRATION).toContain(
      TEXTO_RAPIDO_COM_ATALHO_REPETIDO,
    );
  });

  it('a entidade declara o mesmo nome de índice', () => {
    expect(SNIPPET_ATALHO_UNICO).toBe(UQ_CLINICAL_SNIPPETS_DOCTOR_SHORTCUT);
  });

  it('down derruba o índice', async () => {
    const { queryRunner, query } = criarQueryRunner();
    await new AddUniqueClinicalSnippetShortcut1761000700000().down(queryRunner);
    expect(executadas(query)).toEqual([
      `DROP INDEX IF EXISTS "${UQ_CLINICAL_SNIPPETS_DOCTOR_SHORTCUT}"`,
    ]);
  });
});
