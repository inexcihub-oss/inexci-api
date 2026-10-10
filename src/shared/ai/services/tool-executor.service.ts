import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';
import OpenAI from 'openai';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ToolRegistryService } from './tool-registry.service';
import { AiRedisService } from './ai-redis.service';
import {
  AiTool,
  ANY_AUTHENTICATED,
  ToolContext,
} from '../tools/tool.interface';

export function temPermissaoParaTool(
  exigida: AiTool['requiredPermission'] | undefined,
  context: Pick<ToolContext, 'permissions'>,
): boolean {
  if (exigida === ANY_AUTHENTICATED) return true;
  if (!exigida) return false;
  const aceitas = Array.isArray(exigida) ? exigida : [exigida];
  if (aceitas.length === 0) return false;
  const concedidas = context.permissions ?? [];
  return aceitas.some((p) => concedidas.includes(p));
}

export interface ToolTelemetryEvent {
  toolName: string;
  ownerId: string | null | undefined;
  durationMs: number;
  errorMessage?: string;
}

const TOOL_CACHE_PREFIX = 'tcache:';

interface MemCacheEntry {
  value: string;
  expiresAt: number;
}

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  private readonly memCache = new Map<string, MemCacheEntry>();

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly aiRedis: AiRedisService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  async executeMany(
    toolCalls: OpenAI.ChatCompletionMessageToolCall[],
    context: ToolContext,
  ): Promise<Array<{ toolCallId: string; output: string }>> {
    const results: Array<{ toolCallId: string; output: string }> = [];

    for (const call of toolCalls) {
      const fn = (call as { function: { name: string; arguments: string } })
        .function;
      const startMs = Date.now();
      try {
        const args = JSON.parse(fn.arguments);

        const tool = this.toolRegistry.getTool(fn.name);
        if (!tool) {
          results.push({
            toolCallId: call.id,
            output: `Ferramenta "${fn.name}" não encontrada.`,
          });
          continue;
        }

        if (!temPermissaoParaTool(tool.requiredPermission, context)) {
          this.logger.warn(
            `[TOOL_PERMISSION] ${fn.name} recusada para user=${context.userId}`,
          );
          results.push({
            toolCallId: call.id,
            output:
              'Você não tem permissão para esta ação na plataforma. ' +
              'Fale com o administrador da sua clínica.',
          });
          continue;
        }

        const cacheConfig = tool.cacheable;
        const cacheKey = cacheConfig
          ? this.buildCacheKey(context.ownerId, fn.name, args)
          : null;

        if (cacheKey) {
          const cached = await this.getCached(cacheKey);
          if (cached !== null) {
            this.logger.debug(
              `[TOOL_CACHE] hit tool=${fn.name} owner=${context.ownerId ?? 'anon'}`,
            );
            results.push({ toolCallId: call.id, output: cached });
            continue;
          }
        }

        this.logger.log(
          `Executando tool: ${fn.name} campos=[${Object.keys(args ?? {}).join(',')}]`,
        );
        const output = await tool.execute(args, context);

        if (cacheKey && cacheConfig) {
          await this.setCached(cacheKey, output, cacheConfig.ttlSeconds);
          this.logger.debug(
            `[TOOL_CACHE] stored tool=${fn.name} owner=${context.ownerId ?? 'anon'} ttl=${cacheConfig.ttlSeconds}s`,
          );
        }

        results.push({ toolCallId: call.id, output });
        this.eventEmitter?.emit('tool_succeeded', {
          toolName: fn.name,
          ownerId: context.ownerId,
          durationMs: Date.now() - startMs,
        } satisfies ToolTelemetryEvent);
      } catch (error: any) {
        const logMessage = `Erro na tool ${fn.name}: ${error.message}`;
        if (error instanceof HttpException && error.getStatus() < 500) {
          this.logger.warn(logMessage);
        } else {
          this.logger.error(logMessage);
        }
        this.eventEmitter?.emit('tool_failed', {
          toolName: fn.name,
          ownerId: context.ownerId,
          durationMs: Date.now() - startMs,
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
}
