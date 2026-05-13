import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { OpenaiService } from '../openai.service';
import { ToolExecutorService } from '../tool-executor.service';
import { ConfirmationManagerService } from './confirmation-manager.service';
import {
  CompletionUsageSnapshot,
  OrchestratorTelemetryService,
} from './orchestrator-telemetry.service';
import { ToolContext } from '../../tools/tool.interface';
import { OperationDraftType } from '../../drafts/operation-draft.types';
import { buildToolResult } from '../../tools/tool-result';
import { inexciTracer, SpanStatusCode } from '../../../observability/tracer';

const MAX_TOOL_ITERATIONS = 3;

/**
 * Hooks que delegam responsabilidades específicas do orchestrator que ainda
 * não foram extraídas para outros serviços. Cada hook é puro do ponto de
 * vista do runner — invocado por contrato em momentos bem definidos do loop.
 */
export interface ToolLoopHooks {
  evaluatePlanFirstGuard: (
    toolCalls: OpenAI.ChatCompletionMessageToolCall[],
    conversationId: string,
  ) => Promise<Set<string>>;
  memorizeEntitiesFromToolCall: (input: {
    conversationId: string;
    toolName: string;
    args: Record<string, any>;
    output: string;
  }) => Promise<void>;
  appendNextStepIfNeeded: (
    functionName: string,
    args: Record<string, any>,
    output: string,
    toolContext: ToolContext,
  ) => Promise<string>;
  redactResidualPii: (
    messages: OpenAI.ChatCompletionMessageParam[],
    ctx: { conversationId: string; messageSid: string },
  ) => Promise<void>;
  buildToolsForCurrentDraft: (conversationId: string) => Promise<{
    tools: OpenAI.ChatCompletionTool[];
    draftType: OperationDraftType | null;
  }>;
  buildPromptCacheKey: (draftType: OperationDraftType | null) => string;
  getResponseMaxTokens: () => number;
  getRemainingTimeoutMs: (startedAt: number, totalTimeoutMs: number) => number;
}

export interface ToolLoopInput {
  messages: OpenAI.ChatCompletionMessageParam[];
  initialResponseMessage: OpenAI.ChatCompletionMessage;
  toolContext: ToolContext;
  conversationId: string;
  messageSid: string;
  usageSnapshots: CompletionUsageSnapshot[];
  initialActiveDraftType: OperationDraftType | null;
  initialPromptCacheKey: string;
  processStartedAt: number;
  processTimeoutMs: number;
  hooks: ToolLoopHooks;
}

export interface ToolLoopResult {
  responseMessage: OpenAI.ChatCompletionMessage;
  loopLimitReached: boolean;
  activeDraftType: OperationDraftType | null;
  promptCacheKey: string;
}

/**
 * Executa o loop de tool calls do orchestrator (até `MAX_TOOL_ITERATIONS`
 * iterações). Cuida de:
 *
 * - aplicar o plan-first guard sobre as tool calls solicitadas;
 * - delegar execução para `ToolExecutorService`;
 * - rastrear `pending_confirmation` via `ConfirmationManagerService`;
 * - memorizar entidades extraídas via hook do orchestrator;
 * - enriquecer outputs com hints de próximo passo;
 * - reaplicar redator de PII antes de cada follow-up;
 * - recalcular tools/cache key entre iterações;
 * - capturar snapshots de uso via `OrchestratorTelemetryService`.
 *
 * Quando o limite é atingido, sinaliza `loopLimitReached = true` e o
 * orchestrator decide a mensagem final do usuário.
 */
@Injectable()
export class ToolLoopRunnerService {
  private readonly logger = new Logger(ToolLoopRunnerService.name);

  static readonly MAX_TOOL_ITERATIONS = MAX_TOOL_ITERATIONS;

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly confirmationManager: ConfirmationManagerService,
    private readonly telemetry: OrchestratorTelemetryService,
  ) {}

  async run(input: ToolLoopInput): Promise<ToolLoopResult> {
    const {
      messages,
      toolContext,
      conversationId,
      messageSid,
      usageSnapshots,
      processStartedAt,
      processTimeoutMs,
      hooks,
    } = input;

    let responseMessage = input.initialResponseMessage;
    let activeDraftType = input.initialActiveDraftType;
    let promptCacheKey = input.initialPromptCacheKey;
    let tools: OpenAI.ChatCompletionTool[] = [];

    let iterations = MAX_TOOL_ITERATIONS;
    let followUpIndex = 0;
    let loopLimitReached = false;

    while (responseMessage.tool_calls?.length && iterations > 0) {
      iterations--;
      const iterNum = MAX_TOOL_ITERATIONS - iterations;

      const currentToolCalls = responseMessage.tool_calls!;
      await inexciTracer.startActiveSpan(
        `ai.toolLoop.iteration`,
        async (iterSpan) => {
          iterSpan.setAttribute('ai.tool_loop.iteration', iterNum);
          iterSpan.setAttribute(
            'ai.tool_loop.tool_calls_count',
            currentToolCalls.length,
          );
          try {
            const blockedToolCallIds = await hooks.evaluatePlanFirstGuard(
              currentToolCalls,
              conversationId,
            );

            const toolCallsToExecute = blockedToolCallIds.size
              ? currentToolCalls.filter(
                  (call) => !blockedToolCallIds.has(call.id),
                )
              : currentToolCalls;

            const toolResults = toolCallsToExecute.length
              ? await this.toolExecutor.executeMany(
                  toolCallsToExecute,
                  toolContext,
                )
              : [];

            if (blockedToolCallIds.size) {
              for (const call of currentToolCalls) {
                if (!blockedToolCallIds.has(call.id)) continue;
                toolResults.push({
                  toolCallId: call.id,
                  output: buildToolResult({
                    status: 'blocked',
                    message:
                      'Antes de chamar tools de mutação complexa, chame `plan_actions` para classificar a intenção e abrir o rascunho correspondente.',
                    errors: [
                      {
                        code: 'PLAN_ACTIONS_REQUIRED',
                        message:
                          'Chame `plan_actions` primeiro neste turno para inicializar o rascunho.',
                      },
                    ],
                  }),
                });
              }
            }

            const patchedToolResults = await Promise.all(
              toolResults.map(async (result) => {
                const toolCall = responseMessage.tool_calls?.find(
                  (call) => call.id === result.toolCallId,
                );

                if (!toolCall) return result;

                const functionName = toolCall.function?.name || '';
                let args: Record<string, any> = {};

                try {
                  args = toolCall.function?.arguments
                    ? JSON.parse(toolCall.function.arguments)
                    : {};
                } catch {
                  return result;
                }

                await this.confirmationManager.trackPendingConfirmation({
                  conversationId,
                  toolName: functionName,
                  args,
                  output: result.output,
                });

                await hooks.memorizeEntitiesFromToolCall({
                  conversationId,
                  toolName: functionName,
                  args,
                  output: result.output,
                });

                const enrichedOutput = await hooks.appendNextStepIfNeeded(
                  functionName,
                  args,
                  result.output,
                  toolContext,
                );

                return {
                  ...result,
                  output: enrichedOutput,
                };
              }),
            );

            messages.push(responseMessage as OpenAI.ChatCompletionMessageParam);
            for (const result of patchedToolResults) {
              messages.push({
                role: 'tool',
                tool_call_id: result.toolCallId,
                content: result.output,
              });
            }

            await hooks.redactResidualPii(messages, {
              conversationId,
              messageSid,
            });

            ({ tools, draftType: activeDraftType } =
              await hooks.buildToolsForCurrentDraft(conversationId));
            promptCacheKey = hooks.buildPromptCacheKey(activeDraftType);

            const t0Followup = Date.now();
            const followUp = await this.openaiService.chatCompletion({
              messages,
              tools,
              temperature: 0.2,
              maxTokens: hooks.getResponseMaxTokens(),
              timeoutMs: hooks.getRemainingTimeoutMs(
                processStartedAt,
                processTimeoutMs,
              ),
              cacheKey: promptCacheKey,
            });
            followUpIndex += 1;
            this.telemetry.captureUsageSnapshot(
              usageSnapshots,
              `followup_${followUpIndex}`,
              followUp,
              Date.now() - t0Followup,
              {
                toolsCount: tools.length,
                draftType: activeDraftType,
                cacheKey: promptCacheKey,
              },
            );
            responseMessage = followUp.choices[0].message;
            iterSpan.setStatus({ code: SpanStatusCode.OK });
          } catch (e: any) {
            iterSpan.recordException(e);
            iterSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: e.message,
            });
            throw e;
          } finally {
            iterSpan.end();
          }
        },
      ); // fim startActiveSpan iteration
    }

    if (iterations === 0 && responseMessage.tool_calls?.length) {
      loopLimitReached = true;
      this.logger.warn(
        `[AI_LOOP_LIMIT] sid=${messageSid} conv=${conversationId} iterations=${MAX_TOOL_ITERATIONS} pending_tools=${responseMessage.tool_calls.length} reason=max_iterations_reached`,
      );
    }

    return {
      responseMessage,
      loopLimitReached,
      activeDraftType,
      promptCacheKey,
    };
  }
}
