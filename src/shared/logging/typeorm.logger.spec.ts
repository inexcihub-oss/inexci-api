import { summarizeQuery } from './typeorm.logger';

describe('summarizeQuery', () => {
  it('resume SELECT com a primeira tabela do FROM', () => {
    expect(
      summarizeQuery(
        'SELECT "WhatsappConversation"."id" AS "WhatsappConversation_id", "WhatsappConversation"."phone" FROM "whatsapp_conversations" "WhatsappConversation" WHERE 1=1',
      ),
    ).toBe('SELECT whatsapp_conversations');
  });

  it('resume SELECT mesmo sem aspas na tabela', () => {
    expect(summarizeQuery('SELECT id FROM users WHERE id = $1')).toBe(
      'SELECT users',
    );
  });

  it('resume INSERT com a tabela alvo', () => {
    expect(
      summarizeQuery(
        'INSERT INTO "ai_token_usage_log"("user_id", "tokens") VALUES ($1, $2)',
      ),
    ).toBe('INSERT ai_token_usage_log');
  });

  it('resume UPDATE com a tabela alvo', () => {
    expect(
      summarizeQuery(
        'UPDATE "surgery_requests" SET "status" = $1 WHERE id = $2',
      ),
    ).toBe('UPDATE surgery_requests');
  });

  it('resume DELETE com a tabela alvo', () => {
    expect(
      summarizeQuery('DELETE FROM "refresh_tokens" WHERE user_id = $1'),
    ).toBe('DELETE refresh_tokens');
  });

  it('resume CTE (WITH) usando a primeira tabela encontrada', () => {
    expect(
      summarizeQuery(
        'WITH x AS (SELECT 1) SELECT * FROM "patients" WHERE owner_id = $1',
      ),
    ).toBe('WITH patients');
  });

  it('reconhece transações', () => {
    expect(summarizeQuery('BEGIN')).toBe('BEGIN');
    expect(summarizeQuery('COMMIT')).toBe('COMMIT');
    expect(summarizeQuery('ROLLBACK')).toBe('ROLLBACK');
    expect(summarizeQuery('SAVEPOINT sp1')).toBe('SAVEPOINT');
  });

  it('normaliza espaços e quebras de linha', () => {
    const query = `
      SELECT
        u.id,
        u.name
      FROM "users" u
      WHERE u.id = $1
    `;
    expect(summarizeQuery(query)).toBe('SELECT users');
  });

  it('marca tabela como ? quando não consegue extrair', () => {
    expect(summarizeQuery('SELECT 1')).toBe('SELECT ?');
  });

  it('trunca DDL longa mas preserva o início', () => {
    const long = `CREATE INDEX CONCURRENTLY ${'a'.repeat(200)}`;
    const result = summarizeQuery(long);
    expect(result.startsWith('CREATE INDEX CONCURRENTLY')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
  });

  it('lida com query vazia', () => {
    expect(summarizeQuery('   ')).toBe('(empty)');
  });
});
