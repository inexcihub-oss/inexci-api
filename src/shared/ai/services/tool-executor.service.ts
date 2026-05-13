import { Injectable, Logger, Optional } from '@nestjs/common';
import OpenAI from 'openai';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ToolRegistryService } from './tool-registry.service';
import { AiRedisService } from './ai-redis.service';
import { ToolContext } from '../tools/tool.interface';

/**
 * Payload emitido nos eventos de telemetria de tools.
 * Consumível por listeners de métricas / alertas.
 */
export interface ToolTelemetryEvent {
  toolName: string;
  ownerId: string | null | undefined;
  durationMs: number;
  /** `true` quando a tool ainda acessa um repositório direto (conformidade). */
  bypassedService: boolean;
  /** Apenas no evento `tool_failed`. */
  errorMessage?: string;
}

/**
 * Prefixo usado em todas as chaves do cache de leitura de tools.
 * Mantido curto para não desperdiçar bytes no Redis.
 */
const TOOL_CACHE_PREFIX = 'tcache:';

/**
 * Entrada do fallback in-memory (usado quando o Redis está indisponível).
 */
interface MemCacheEntry {
  value: string;
  expiresAt: number;
}

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  /**
   * Fallback in-memory para quando o Redis está indisponível.
   * Como o serviço é singleton, o Map é compartilhado entre requests —
   * comportamento desejado para o cache de leitura (TUSS/CID/catálogo).
   */
  private readonly memCache = new Map<string, MemCacheEntry>();

  /**
   * Índice reverso: toolName que foi executada → lista de tools cacheáveis
   * cujo cache deve ser invalidado. Construído em `buildInvalidationIndex`
   * na primeira execução (lazy, pois o registry pode não ter todas as tools
   * registradas no construtor).
   *
   * Ex.: 'patient_draft_commit' → ['list_sc_creation_catalog']
   */
  private invalidationIndex: Map<string, string[]> | null = null;

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly aiRedis: AiRedisService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  async executeMany(
    toolCalls: OpenAI.ChatCompletionMessageToolCall[],
    context: ToolContext,
  ): Promise<Array<{ toolCallId: string; output: string }>> {
    this.ensureInvalidationIndex();

    const results: Array<{ toolCallId: string; output: string }> = [];

    for (const call of toolCalls) {
      const fn = (call as any).function as { name: string; arguments: string };
      try {
        const args = JSON.parse(fn.arguments);

        const tool = this.toolRegistry.getTool(fn.name);
        const cacheConfig = tool?.cacheable;
        const bypassedService = tool?.bypassesService ?? false;

        const telemetryBase: Omit<ToolTelemetryEvent, 'durationMs'> = {
          toolName: fn.name,
          ownerId: context.ownerId,
          bypassedService,
        };

        this.eventEmitter?.emit('tool_called', {
          ...telemetryBase,
          durationMs: 0,
        } satisfies ToolTelemetryEvent);

        const startMs = Date.now();

        if (cacheConfig) {
          const cacheKey = this.buildCacheKey(context.ownerId, fn.name, args);
          const cached = await this.getCached(cacheKey);
          if (cached !== null) {
            this.logger.debug(
              `[TOOL_CACHE] hit tool=${fn.name} owner=${context.ownerId ?? 'anon'}`,
            );
            results.push({ toolCallId: call.id, output: cached });
            continue;
          }
          this.logger.log(
            `Executando tool: ${fn.name} args=${JSON.stringify(args)}`,
          );
          const output = await this.toolRegistry.executeTool(
            fn.name,
            args,
            context,
          );
          await this.setCached(cacheKey, output, cacheConfig.ttlSeconds);
          this.logger.debug(
            `[TOOL_CACHE] stored tool=${fn.name} owner=${context.ownerId ?? 'anon'} ttl=${cacheConfig.ttlSeconds}s`,
          );
          results.push({ toolCallId: call.id, output });
          this.eventEmitter?.emit('tool_succeeded', {
            ...telemetryBase,
            durationMs: Date.now() - startMs,
          } satisfies ToolTelemetryEvent);
        } else {
          this.logger.log(
            `Executando tool: ${fn.name} args=${JSON.stringify(args)}`,
          );
          const output = await this.toolRegistry.executeTool(
            fn.name,
            args,
            context,
          );
          results.push({ toolCallId: call.id, output });
          this.eventEmitter?.emit('tool_succeeded', {
            ...telemetryBase,
            durationMs: Date.now() - startMs,
          } satisfies ToolTelemetryEvent);

          // Após executar uma tool de mutação, invalida caches que a listam
          // em `invalidatesOn`.
          const toInvalidate = this.invalidationIndex!.get(fn.name) ?? [];
          for (const cachedToolName of toInvalidate) {
            this.invalidateByOwnerAndTool(context.ownerId, cachedToolName);
            this.logger.debug(
              `[TOOL_CACHE] invalidated tool=${cachedToolName} owner=${context.ownerId ?? 'anon'} trigger=${fn.name}`,
            );
          }
        }
      } catch (error: any) {
        this.logger.error(`Erro na tool ${fn.name}: ${error.message}`);
        this.eventEmitter?.emit('tool_failed', {
          toolName: fn.name,
          ownerId: context.ownerId,
          bypassedService:
            this.toolRegistry.getTool(fn.name)?.bypassesService ?? false,
          durationMs: 0,
          errorMessage: error?.message ?? String(error),
        } satisfies ToolTelemetryEvent);
        results.push({
          toolCallId: call.id,
          output: `Erro ao executar ação: ${error.message}`,
        });
      }
    }

    return results;
  }

  // ─── helpers de cache ───────────────────────────────────────────────────────

  /**
   * Chave canônica: `tcache:${owner}:${toolName}:${argsJson}`.
   * Args são serializados com chaves ordenadas para garantir equivalência
   * semântica (`{a:1,b:2}` e `{b:2,a:1}` geram a mesma chave).
   */
  buildCacheKey(
    ownerId: string | null | undefined,
    toolName: string,
    args: Record<string, any>,
  ): string {
    const owner = ownerId ?? 'anon';
    const argsStr = JSON.stringify(args, Object.keys(args).sort());
    return `${TOOL_CACHE_PREFIX}${owner}:${toolName}:${argsStr}`;
  }

  private async getCached(key: string): Promise<string | null> {
    // Redis tem prioridade; in-memory é fallback.
    if (this.aiRedis.isAvailable) {
      return this.aiRedis.cacheGet<string>(key);
    }
    return this.getMemCached(key);
  }

  private async setCached(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    if (this.aiRedis.isAvailable) {
      await this.aiRedis.cacheSet(key, value, ttlSeconds);
    }
    // Sempre popula o in-memory (cobre o período de indisponibilidade do Redis
    // e garante hit instantâneo para chamadas na mesma instância).
    this.setMemCached(key, value, ttlSeconds);
  }

  private getMemCached(key: string): string | null {
    const entry = this.memCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memCache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setMemCached(key: string, value: string, ttlSeconds: number): void {
    this.memCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Invalida todas as entradas in-memory para um dado `ownerId` + `toolName`.
   * Para o Redis, deleta a chave exata se soubermos o argsHash — mas como não
   * armazenamos o índice de chaves, delegamos a invalidação Redis ao TTL
   * curto da tool (30 s para `list_sc_creation_catalog`).
   *
   * Na prática, a invalidação in-memory cobre o caso mais crítico (mesma
   * instância, mesmo turno) e o TTL cobre o restante.
   */
  invalidateByOwnerAndTool(
    ownerId: string | null | undefined,
    toolName: string,
  ): void {
    const prefix = `${TOOL_CACHE_PREFIX}${ownerId ?? 'anon'}:${toolName}:`;
    for (const key of this.memCache.keys()) {
      if (key.startsWith(prefix)) {
        this.memCache.delete(key);
      }
    }
  }

  // ─── índice de invalidação ──────────────────────────────────────────────────

  /**
   * Constrói o índice reverso de invalidação uma única vez, na primeira
   * chamada de `executeMany`. Lazy para garantir que o `ToolRegistryService`
   * já terminou de registrar todas as tools (o registry chama `registerAll`
   * no construtor, mas `OnModuleInit` pode não ter rodado ainda em testes).
   */
  private ensureInvalidationIndex(): void {
    if (this.invalidationIndex !== null) return;
    this.invalidationIndex = new Map<string, string[]>();

    for (const [, tool] of (this.toolRegistry as any).tools as Map<
      string,
      { name: string; cacheable?: { invalidatesOn?: string[] } }
    >) {
      if (!tool.cacheable?.invalidatesOn?.length) continue;
      for (const trigger of tool.cacheable.invalidatesOn) {
        const existing = this.invalidationIndex.get(trigger) ?? [];
        existing.push(tool.name);
        this.invalidationIndex.set(trigger, existing);
      }
    }
  }
}
