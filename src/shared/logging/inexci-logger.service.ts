import { ConsoleLogger, Injectable, LogLevel, Scope } from '@nestjs/common';
import { getRequestContext } from './request-context';

const NEST_LEVEL_RANK: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  log: 3,
  debug: 4,
  verbose: 5,
};

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
};

const LEVEL_COLOR: Record<string, string> = {
  fatal: ANSI.red,
  error: ANSI.red,
  warn: ANSI.yellow,
  log: ANSI.green,
  debug: ANSI.cyan,
  verbose: ANSI.gray,
};

/**
 * Logger custom do Nest. Emite **uma linha JSON** por evento em produção
 * (timestamp ISO, level, context, message, requestId, userId, tenantId,
 * extras opcionais) e mantém output legível com cores em desenvolvimento.
 *
 * Comportamento controlado por env:
 * - `LOG_LEVEL` (default `log`) — filtra severidades.
 * - `LOG_PRETTY` ('true'/'false', default automático) — formato pretty
 *   ativado quando `NODE_ENV=development`.
 *
 * Os ~60 services existentes que usam `new Logger(Class.name)` continuam
 * funcionando inalterados — eles delegam para o nosso logger via
 * `app.useLogger(InexciLogger)` no bootstrap.
 */
@Injectable({ scope: Scope.DEFAULT })
export class InexciLogger extends ConsoleLogger {
  private readonly minRank: number;
  private readonly pretty: boolean;

  constructor() {
    super();
    const level = (process.env.LOG_LEVEL || 'log') as LogLevel;
    this.minRank = NEST_LEVEL_RANK[level] ?? NEST_LEVEL_RANK.log;

    const explicit = (process.env.LOG_PRETTY || '').toLowerCase().trim();
    if (explicit === 'true' || explicit === '1') {
      this.pretty = true;
    } else if (explicit === 'false' || explicit === '0') {
      this.pretty = false;
    } else {
      this.pretty = process.env.NODE_ENV !== 'production';
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return (NEST_LEVEL_RANK[level] ?? 99) <= this.minRank;
  }

  log(message: any, context?: string): void {
    if (!this.shouldLog('log')) return;
    this.write('log', message, context);
  }

  error(message: any, stack?: string, context?: string): void {
    if (!this.shouldLog('error')) return;
    this.write('error', message, context, stack);
  }

  warn(message: any, context?: string): void {
    if (!this.shouldLog('warn')) return;
    this.write('warn', message, context);
  }

  debug(message: any, context?: string): void {
    if (!this.shouldLog('debug')) return;
    this.write('debug', message, context);
  }

  verbose(message: any, context?: string): void {
    if (!this.shouldLog('verbose')) return;
    this.write('verbose', message, context);
  }

  private write(
    level: LogLevel,
    rawMessage: unknown,
    context?: string,
    stack?: string,
  ): void {
    const ctx = getRequestContext();
    const now = new Date().toISOString();
    const message = this.normalizeMessage(rawMessage);

    if (this.pretty) {
      this.writePretty(level, now, message, context, ctx, stack);
      return;
    }

    const payload: Record<string, unknown> = {
      timestamp: now,
      level,
      context: context ?? this.context ?? null,
      message,
    };
    if (ctx?.requestId) payload.requestId = ctx.requestId;
    if (ctx?.userId) payload.userId = ctx.userId;
    if (ctx?.tenantId) payload.tenantId = ctx.tenantId;
    if (stack) payload.stack = stack;

    const line = this.safeStringify(payload);
    const stream =
      level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(line + '\n');
  }

  private writePretty(
    level: LogLevel,
    timestamp: string,
    message: string,
    context: string | undefined,
    ctx: ReturnType<typeof getRequestContext>,
    stack?: string,
  ): void {
    const color = LEVEL_COLOR[level] || ANSI.reset;
    const ctxLabel = context ?? this.context;
    const reqTag = ctx?.requestId
      ? `${ANSI.gray}[${ctx.requestId.slice(0, 8)}]${ANSI.reset} `
      : '';
    const userTag = ctx?.userId
      ? `${ANSI.magenta}user=${ctx.userId.slice(0, 8)}${ANSI.reset} `
      : '';
    const ctxTag = ctxLabel ? `${ANSI.cyan}[${ctxLabel}]${ANSI.reset} ` : '';
    const head = `${ANSI.gray}${timestamp}${ANSI.reset} ${color}${ANSI.bold}${level.toUpperCase().padEnd(7)}${ANSI.reset}`;
    const line = `${head} ${reqTag}${userTag}${ctxTag}${message}`;
    const stream =
      level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(line + '\n');
    if (stack) stream.write(`${ANSI.gray}${stack}${ANSI.reset}\n`);
  }

  private normalizeMessage(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    if (value instanceof Error) return value.message;
    return this.safeStringify(value);
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
