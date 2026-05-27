import { Logger as NestLogger } from '@nestjs/common';
import type { Logger as TypeOrmLogger } from 'typeorm';

/**
 * Logger compacto para o TypeORM.
 *
 * Em vez de despejar a query SQL inteira (com colunas, joins e parâmetros —
 * incluindo embeddings vetoriais do RAG, que são gigantes), emite uma única
 * linha curta no formato `OPERAÇÃO tabela`, por exemplo:
 *
 *   [TypeORM] SELECT whatsapp_conversations
 *   [TypeORM] INSERT ai_token_usage_log
 *   [TypeORM] UPDATE surgery_requests
 *   [TypeORM] BEGIN
 *
 * Erros de query continuam logados em `error` (com a mensagem do banco) e
 * slow queries em `warn` (com tempo). Para ver a query completa quando
 * necessário, defina `DB_LOG_FULL_QUERIES=true`.
 *
 * Para silenciar completamente o sumário de queries (mantendo apenas erros e
 * slow), basta subir o `LOG_LEVEL` para `warn`.
 */
export class CompactTypeOrmLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('TypeORM');
  private readonly fullQueries: boolean;

  constructor() {
    const flag = (process.env.DB_LOG_FULL_QUERIES || '').toLowerCase().trim();
    this.fullQueries = flag === 'true' || flag === '1';
  }

  logQuery(query: string, parameters?: unknown[]): void {
    this.logger.log(this.format(query, parameters));
  }

  logQueryError(
    error: string | Error,
    query: string,
    parameters?: unknown[],
  ): void {
    const summary = this.format(query, parameters);
    const reason = error instanceof Error ? error.message : error;
    this.logger.error(`${summary} — ${reason}`);
  }

  logQuerySlow(time: number, query: string, parameters?: unknown[]): void {
    this.logger.warn(`SLOW (${time}ms) ${this.format(query, parameters)}`);
  }

  logSchemaBuild(message: string): void {
    this.logger.log(message);
  }

  logMigration(message: string): void {
    this.logger.log(message);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    const text = typeof message === 'string' ? message : safeStringify(message);
    if (level === 'warn') {
      this.logger.warn(text);
    } else {
      this.logger.log(text);
    }
  }

  private format(query: string, parameters?: unknown[]): string {
    if (this.fullQueries) {
      const params = parameters?.length
        ? ` -- ${truncate(safeStringify(parameters), 300)}`
        : '';
      return `${query}${params}`;
    }
    return summarizeQuery(query);
  }
}

/**
 * Extrai apenas a operação (SELECT/INSERT/UPDATE/DELETE/...) e a tabela
 * principal envolvida. Função pura/testável.
 */
export function summarizeQuery(rawQuery: string): string {
  const query = rawQuery.trim().replace(/\s+/g, ' ');
  if (!query) return '(empty)';

  const upper = query.toUpperCase();

  if (upper.startsWith('SELECT')) {
    const table = matchTable(query, /\bFROM\s+("?[\w.]+"?)/i);
    return `SELECT ${table ?? '?'}`;
  }
  if (upper.startsWith('INSERT')) {
    const table = matchTable(query, /\bINSERT\s+INTO\s+("?[\w.]+"?)/i);
    return `INSERT ${table ?? '?'}`;
  }
  if (upper.startsWith('UPDATE')) {
    const table = matchTable(query, /\bUPDATE\s+("?[\w.]+"?)/i);
    return `UPDATE ${table ?? '?'}`;
  }
  if (upper.startsWith('DELETE')) {
    const table = matchTable(query, /\bDELETE\s+FROM\s+("?[\w.]+"?)/i);
    return `DELETE ${table ?? '?'}`;
  }
  if (upper.startsWith('WITH')) {
    const table =
      matchTable(query, /\bFROM\s+("?[\w.]+"?)/i) ??
      matchTable(query, /\bUPDATE\s+("?[\w.]+"?)/i) ??
      matchTable(query, /\bINSERT\s+INTO\s+("?[\w.]+"?)/i);
    return `WITH ${table ?? '?'}`;
  }
  if (upper.startsWith('BEGIN')) return 'BEGIN';
  if (upper.startsWith('COMMIT')) return 'COMMIT';
  if (upper.startsWith('ROLLBACK')) return 'ROLLBACK';
  if (upper.startsWith('SAVEPOINT')) return 'SAVEPOINT';
  if (upper.startsWith('RELEASE')) return 'RELEASE SAVEPOINT';
  if (upper.startsWith('SET ')) return truncate(query, 80);
  if (
    upper.startsWith('CREATE') ||
    upper.startsWith('ALTER') ||
    upper.startsWith('DROP') ||
    upper.startsWith('TRUNCATE')
  ) {
    return truncate(query, 120);
  }

  return truncate(query, 80);
}

function matchTable(query: string, regex: RegExp): string | null {
  const m = query.match(regex);
  if (!m?.[1]) return null;
  return m[1].replace(/"/g, '');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
