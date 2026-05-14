import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PiiVaultService, SerializedPiiBindings } from '../pii-vault.service';
import { AiRedisService } from '../ai-redis.service';
import { AiPiiRedactionLogRepository } from '../../../../database/repositories/ai-pii-redaction-log.repository';
import { PII_VAULT_PERSIST_TTL_SECONDS } from '../../constants/ai.constants';

const PII_VAULT_REDIS_KEY_PREFIX = 'pii:vault:';

interface PiiBindingCacheEntry {
  bindings: SerializedPiiBindings;
  expiresAt: number;
}

/**
 * Gerencia a persistência dos bindings do PII Vault entre turnos da conversa
 * e a redação defensiva de PII residual no histórico antes de cada chamada
 * à OpenAI.
 *
 * Extraído de `AiOrchestratorService` na Fase 5 do
 * `PLANO-CORRECOES-CODE-REVIEW-2026-05-13.md`.
 */
@Injectable()
export class PiiBindingService {
  private readonly logger = new Logger(PiiBindingService.name);
  /**
   * Fallback in-memory dos bindings do PII vault por conversa, usado quando
   * o Redis não estiver disponível. Preserva placeholder→valor real entre
   * turnos consecutivos para que `detokenize` funcione mesmo após reinícios
   * de sessão do vault. Em produção, a persistência primária é Redis.
   */
  private readonly inMemoryPiiBindings = new Map<
    string,
    PiiBindingCacheEntry
  >();

  constructor(
    private readonly piiVault: PiiVaultService,
    private readonly aiRedis: AiRedisService,
    private readonly piiRedactionLogRepo: AiPiiRedactionLogRepository,
  ) {}

  /**
   * Carrega bindings do PII vault persistidos no turno anterior da mesma
   * conversa. Sem isso, placeholders (`{{protocol_1}}`, `{{patient_name_1}}`…)
   * já presentes no histórico aparecem órfãos no detokenize do próximo turno.
   *
   * Estratégia primária: Redis (compartilhada entre instâncias).
   * Fallback: Map in-memory com TTL local.
   */
  async loadPersistedPiiBindings(
    conversationId: string,
  ): Promise<SerializedPiiBindings | null> {
    const key = `${PII_VAULT_REDIS_KEY_PREFIX}${conversationId}`;
    if (this.aiRedis.isAvailable) {
      try {
        const stored = await this.aiRedis.cacheGet<SerializedPiiBindings>(key);
        if (Array.isArray(stored)) return stored;
      } catch (err: any) {
        this.logger.debug(
          `[PII_VAULT_PERSIST] redis_load_failed conv=${conversationId} err=${err?.message || err}`,
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

  /**
   * Serializa o estado atual do vault para esta conversa e persiste com TTL.
   * Chamado após o detokenize da resposta final, antes de encerrar a sessão.
   */
  async persistPiiBindings(conversationId: string): Promise<void> {
    let snapshot: SerializedPiiBindings = [];
    try {
      snapshot = this.piiVault.serializeSession(conversationId);
    } catch (err: any) {
      this.logger.debug(
        `[PII_VAULT_PERSIST] serialize_failed conv=${conversationId} err=${err?.message || err}`,
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
      } catch (err: any) {
        this.logger.debug(
          `[PII_VAULT_PERSIST] redis_save_failed conv=${conversationId} err=${err?.message || err}`,
        );
      }
    }

    this.inMemoryPiiBindings.set(conversationId, {
      bindings: snapshot,
      expiresAt: Date.now() + PII_VAULT_PERSIST_TTL_SECONDS * 1000,
    });
  }

  /**
   * Filtro defensivo (T0.7 — versão "redact, don't block"): varre as
   * mensagens que serão enviadas à OpenAI e MASCARA in-place qualquer PII
   * estrutural residual (CPF, telefone BR, e-mail) por placeholders
   * genéricos. Mensagens com role `assistant` são ignoradas.
   *
   * Cada redação é registrada em `ai_pii_redaction_log` com `blocked=false`.
   */
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
      } catch (logErr: any) {
        this.logger.warn(
          `Falha ao registrar pii_redaction_log: ${logErr?.message || 'erro desconhecido'}`,
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
