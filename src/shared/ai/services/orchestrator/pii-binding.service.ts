import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PiiVaultService, SerializedPiiBindings } from '../pii-vault.service';
import { AiRedisService } from '../ai-redis.service';
import { AiPiiRedactionLogRepository } from '../../../../database/repositories/ai-pii-redaction-log.repository';
import { PII_VAULT_PERSIST_TTL_SECONDS } from '../../constants/ai.constants';
import { errorMessage } from '../../../utils/error-message.util';

const PII_VAULT_REDIS_KEY_PREFIX = 'pii:vault:';

interface PiiBindingCacheEntry {
  bindings: SerializedPiiBindings;
  expiresAt: number;
}

@Injectable()
export class PiiBindingService {
  private readonly logger = new Logger(PiiBindingService.name);
  private readonly inMemoryPiiBindings = new Map<
    string,
    PiiBindingCacheEntry
  >();

  constructor(
    private readonly piiVault: PiiVaultService,
    private readonly aiRedis: AiRedisService,
    private readonly piiRedactionLogRepo: AiPiiRedactionLogRepository,
  ) {}

  async loadPersistedPiiBindings(
    conversationId: string,
  ): Promise<SerializedPiiBindings | null> {
    const key = `${PII_VAULT_REDIS_KEY_PREFIX}${conversationId}`;
    if (this.aiRedis.isAvailable) {
      try {
        const stored = await this.aiRedis.cacheGet<SerializedPiiBindings>(key);
        if (Array.isArray(stored)) return stored;
      } catch (err) {
        this.logger.debug(
          `[PII_VAULT_PERSIST] redis_load_failed conv=${conversationId} err=${errorMessage(err)}`,
        );
      }
    }

    const fallback = this.inMemoryPiiBindings.get(conversationId);
    if (!fallback) return null;
    if (Date.now() > fallback.expiresAt) {
      this.inMemoryPiiBindings.delete(conversationId);
      return null;
    }
    return fallback.bindings;
  }

  async persistPiiBindings(conversationId: string): Promise<void> {
    let snapshot: SerializedPiiBindings = [];
    try {
      snapshot = this.piiVault.serializeSession(conversationId);
    } catch (err) {
      this.logger.debug(
        `[PII_VAULT_PERSIST] serialize_failed conv=${conversationId} err=${errorMessage(err)}`,
      );
      return;
    }

    if (!snapshot.length) return;

    const key = `${PII_VAULT_REDIS_KEY_PREFIX}${conversationId}`;
    if (this.aiRedis.isAvailable) {
      try {
        await this.aiRedis.cacheSet(
          key,
          snapshot,
          PII_VAULT_PERSIST_TTL_SECONDS,
        );
        return;
      } catch (err) {
        this.logger.debug(
          `[PII_VAULT_PERSIST] redis_save_failed conv=${conversationId} err=${errorMessage(err)}`,
        );
      }
    }

    this.inMemoryPiiBindings.set(conversationId, {
      bindings: snapshot,
      expiresAt: Date.now() + PII_VAULT_PERSIST_TTL_SECONDS * 1000,
    });
  }

  async redactResidualPii(
    messages: OpenAI.ChatCompletionMessageParam[],
    context: { conversationId: string; messageSid: string; toolName?: string },
  ): Promise<void> {
    for (const message of messages) {
      if (message.role === 'assistant') continue;
      const content = message.content;
      if (typeof content !== 'string' || !content) continue;
      const findings = this.piiVault.detectResidualPii(content);
      if (!findings.length) continue;

      const masked = this.piiVault.maskLiteralPii(content);
      (message as { content: string }).content = masked.text;

      const first = findings[0];
      try {
        await this.piiRedactionLogRepo.create({
          conversationId: context.conversationId,
          messageSid: context.messageSid,
          category: first.category,
          valueHash: this.piiVault.hashValue(first.sample),
          blocked: false,
          toolName: context.toolName ?? null,
          occurrences: findings.length,
        });
      } catch (logErr) {
        this.logger.warn(
          `Falha ao registrar pii_redaction_log: ${errorMessage(logErr) || 'erro desconhecido'}`,
        );
      }

      const breakdown = masked.masked.length
        ? masked.masked.map((m) => `${m.category}=${m.count}`).join(',')
        : findings.map((f) => f.category).join(',');
      this.logger.warn(
        `[AI_PII_REDACT] sid=${context.messageSid} role=${message.role} occurrences=${findings.length} ${breakdown}`,
      );
    }
  }
}
