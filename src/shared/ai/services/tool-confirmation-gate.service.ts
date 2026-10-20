import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiRedisService } from './ai-redis.service';
import { isAffirmativeConfirmation } from './orchestrator/confirmation-phrases';
import { errorMessage } from '../../utils/error-message.util';

export const CONFIRMATION_TOKEN_TTL_SECONDS = 15 * 60;

const KEY_PREFIX = 'confirm:';
const MAX_ENTRIES = 10;

interface ConfirmationTokenEntry {
  tool: string;
  hash: string;
  userId: string | null;
  turnId: string | null;
  createdAt: number;
}

interface ConfirmationTokenRecord {
  lastTurnId: string | null;
  entries: ConfirmationTokenEntry[];
}

export interface ConfirmationTokenInput {
  conversationId: string;
  userId: string | null;
  turnId: string | null | undefined;
  tool: string;
  args: Record<string, unknown>;
  fingerprint?: unknown;
}

export type ConfirmationConsumeResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'not_affirmative'
        | 'no_token'
        | 'same_turn'
        | 'missing_turn'
        | 'store_error';
    };

function canonicalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const c = canonicalize(item);
      return c === undefined ? null : c;
    });
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const c = canonicalize((value as Record<string, unknown>)[key]);
      if (c !== undefined) out[key] = c;
    }
    return out;
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

export function confirmationArgsHash(
  args: Record<string, unknown> | null | undefined,
  fingerprint?: unknown,
): string {
  const semConfirm: Record<string, unknown> = { ...(args ?? {}) };
  delete semConfirm.confirm;
  const payload = JSON.stringify(
    canonicalize({ args: semConfirm, fingerprint: fingerprint ?? null }),
  );
  return createHash('sha256').update(payload).digest('hex');
}

@Injectable()
export class ToolConfirmationGateService {
  private readonly logger = new Logger(ToolConfirmationGateService.name);
  private readonly memStore = new Map<
    string,
    { record: ConfirmationTokenRecord; expiresAt: number }
  >();

  constructor(private readonly aiRedis: AiRedisService) {}

  async beginTurn(
    conversationId: string,
    turnId: string | null | undefined,
    userMessage: string | null | undefined,
  ): Promise<void> {
    if (!conversationId || !turnId) return;
    const record = await this.read(conversationId);
    if (record.lastTurnId === turnId) return;
    const affirmative = isAffirmativeConfirmation(userMessage ?? '');
    const anterior = record.lastTurnId;
    const entries = affirmative
      ? record.entries.filter((e) => e.turnId === anterior)
      : [];
    await this.write(conversationId, { lastTurnId: turnId, entries });
  }

  async register(input: ConfirmationTokenInput): Promise<void> {
    if (!input.conversationId) return;
    const record = await this.read(input.conversationId);
    const turnId = input.turnId ?? null;
    const hash = confirmationArgsHash(input.args, input.fingerprint);
    const entries = record.entries.filter(
      (e) => e.turnId === turnId && !(e.tool === input.tool && e.hash === hash),
    );
    entries.push({
      tool: input.tool,
      hash,
      userId: input.userId,
      turnId,
      createdAt: Date.now(),
    });
    await this.write(input.conversationId, {
      lastTurnId: record.lastTurnId ?? turnId,
      entries: entries.slice(-MAX_ENTRIES),
    });
    this.logger.log(
      `[CONFIRM_TOKEN] registered conv=${input.conversationId} tool=${input.tool}`,
    );
  }

  async consume(
    input: ConfirmationTokenInput & { userMessage: string | null | undefined },
  ): Promise<ConfirmationConsumeResult> {
    if (!input.turnId) return { ok: false, reason: 'missing_turn' };
    if (!isAffirmativeConfirmation(input.userMessage ?? '')) {
      return { ok: false, reason: 'not_affirmative' };
    }
    let record: ConfirmationTokenRecord;
    try {
      record = await this.read(input.conversationId);
    } catch (err) {
      this.logger.warn(
        `[CONFIRM_TOKEN] read_failed conv=${input.conversationId} err=${errorMessage(err)}`,
      );
      return { ok: false, reason: 'store_error' };
    }
    const hash = confirmationArgsHash(input.args, input.fingerprint);
    const limite = Date.now() - CONFIRMATION_TOKEN_TTL_SECONDS * 1000;
    const candidatos = record.entries.filter(
      (e) =>
        e.tool === input.tool &&
        e.hash === hash &&
        e.userId === input.userId &&
        e.createdAt >= limite,
    );
    if (!candidatos.length) return { ok: false, reason: 'no_token' };
    const valido = candidatos.find((e) => e.turnId !== input.turnId);
    if (!valido) return { ok: false, reason: 'same_turn' };
    await this.write(input.conversationId, {
      lastTurnId: record.lastTurnId,
      entries: record.entries.filter((e) => e !== valido),
    });
    return { ok: true };
  }

  async clear(conversationId: string): Promise<void> {
    if (!conversationId) return;
    const record = await this.read(conversationId);
    await this.write(conversationId, {
      lastTurnId: record.lastTurnId,
      entries: [],
    });
  }

  private key(conversationId: string): string {
    return `${KEY_PREFIX}${conversationId}`;
  }

  private async read(conversationId: string): Promise<ConfirmationTokenRecord> {
    const key = this.key(conversationId);
    if (this.aiRedis.isAvailable) {
      const stored = await this.aiRedis.cacheGet<ConfirmationTokenRecord>(key);
      return this.sanitize(stored);
    }
    const mem = this.memStore.get(key);
    if (!mem || mem.expiresAt < Date.now()) {
      this.memStore.delete(key);
      return { lastTurnId: null, entries: [] };
    }
    return this.sanitize(mem.record);
  }

  private async write(
    conversationId: string,
    record: ConfirmationTokenRecord,
  ): Promise<void> {
    const key = this.key(conversationId);
    if (this.aiRedis.isAvailable) {
      await this.aiRedis.cacheSet(key, record, CONFIRMATION_TOKEN_TTL_SECONDS);
      return;
    }
    this.memStore.set(key, {
      record: { lastTurnId: record.lastTurnId, entries: [...record.entries] },
      expiresAt: Date.now() + CONFIRMATION_TOKEN_TTL_SECONDS * 1000,
    });
  }

  private sanitize(
    raw: ConfirmationTokenRecord | null | undefined,
  ): ConfirmationTokenRecord {
    if (!raw || typeof raw !== 'object') {
      return { lastTurnId: null, entries: [] };
    }
    const entries = Array.isArray(raw.entries)
      ? raw.entries.filter(
          (e): e is ConfirmationTokenEntry =>
            !!e &&
            typeof e.tool === 'string' &&
            typeof e.hash === 'string' &&
            typeof e.createdAt === 'number',
        )
      : [];
    return {
      lastTurnId: typeof raw.lastTurnId === 'string' ? raw.lastTurnId : null,
      entries,
    };
  }
}
