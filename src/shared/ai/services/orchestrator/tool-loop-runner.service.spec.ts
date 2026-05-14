import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PiiVaultService } from '../pii-vault.service';
import {
  ToolLoopHooks,
  ToolLoopInput,
  ToolLoopRunnerService,
} from './tool-loop-runner.service';
import { ConfirmationManagerService } from './confirmation-manager.service';
import { OrchestratorTelemetryService } from './orchestrator-telemetry.service';
import { PhoneNormalizerService } from './phone-normalizer.service';

const buildToolCall = (
  id: string,
  name: string,
  args: Record<string, any> = {},
): OpenAI.ChatCompletionMessageToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

const buildAssistantMessage = (
  toolCalls?: OpenAI.ChatCompletionMessageToolCall[],
  content: string | null = null,
): OpenAI.ChatCompletionMessage =>
  ({
    role: 'assistant',
    content,
    refusal: null,
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
  }) as OpenAI.ChatCompletionMessage;

const buildCompletion = (
  message: OpenAI.ChatCompletionMessage,
): OpenAI.ChatCompletion =>
  ({
    id: 'cmpl-1',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4o',
    choices: [{ index: 0, message, finish_reason: 'stop', logprobs: null }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  }) as OpenAI.ChatCompletion;

const buildHooks = (overrides: Partial<ToolLoopHooks> = {}): ToolLoopHooks => ({
  evaluatePlanFirstGuard: jest.fn().mockResolvedValue(new Set<string>()),
  memorizeEntitiesFromToolCall: jest.fn().mockResolvedValue(undefined),
  appendNextStepIfNeeded: jest.fn(async (_n, _a, output) => output),
  redactResidualPii: jest.fn().mockResolvedValue(undefined),
  buildToolsForCurrentDraft: jest
    .fn()
    .mockResolvedValue({ tools: [], draftType: null }),
  buildPromptCacheKey: jest.fn().mockReturnValue('cache:none'),
  getResponseMaxTokens: jest.fn().mockReturnValue(1024),
  getRemainingTimeoutMs: jest.fn().mockReturnValue(30000),
  ...overrides,
});

describe('ToolLoopRunnerService', () => {
  let openaiService: { chatCompletion: jest.Mock };
  let toolExecutor: { executeMany: jest.Mock };
  let confirmationManager: ConfirmationManagerService;
  let telemetry: OrchestratorTelemetryService;
  let runner: ToolLoopRunnerService;

  beforeEach(() => {
    openaiService = { chatCompletion: jest.fn() };
    toolExecutor = { executeMany: jest.fn() };

    confirmationManager = new ConfirmationManagerService(
      { findOne: jest.fn(), update: jest.fn() } as any,
      { loadRecentForLlm: jest.fn() } as any,
    );
    jest
      .spyOn(confirmationManager, 'trackPendingConfirmation')
      .mockResolvedValue(undefined);

    telemetry = new OrchestratorTelemetryService(
      { create: jest.fn() } as any,
      new PhoneNormalizerService({} as any),
      {
        categoryCounts: jest.fn().mockReturnValue({}),
      } as unknown as PiiVaultService,
    );
    jest.spyOn(telemetry, 'captureUsageSnapshot');

    runner = new ToolLoopRunnerService(
      openaiService as any,
      toolExecutor as any,
      confirmationManager,
      telemetry,
    );
  });

  const buildInput = (
    initialResponseMessage: OpenAI.ChatCompletionMessage,
    overrides: Partial<ToolLoopInput> = {},
  ): ToolLoopInput => ({
    messages: [],
    initialResponseMessage,
    toolContext: {
      userId: 'u',
      phone: 'p',
      accessibleDoctorIds: [],
      ownerId: 'o',
      conversationId: 'c1',
      inboundMedia: [],
      piiVault: {} as any,
    },
    conversationId: 'c1',
    messageSid: 'sid-1',
    usageSnapshots: [],
    initialActiveDraftType: null,
    initialPromptCacheKey: 'cache:none',
    processStartedAt: Date.now(),
    processTimeoutMs: 60000,
    hooks: buildHooks(),
    ...overrides,
  });

  it('returns immediately when initial message has no tool calls', async () => {
    const initial = buildAssistantMessage(undefined, 'oi');
    const result = await runner.run(buildInput(initial));
    expect(result.loopLimitReached).toBe(false);
    expect(result.responseMessage).toBe(initial);
    expect(toolExecutor.executeMany).not.toHaveBeenCalled();
    expect(openaiService.chatCompletion).not.toHaveBeenCalled();
  });

  it('executes tool calls, tracks pending_confirmation and returns final assistant message', async () => {
    const toolCall = buildToolCall('call-1', 'create_patient', {
      name: 'Maria',
    });
    const initial = buildAssistantMessage([toolCall]);
    toolExecutor.executeMany.mockResolvedValueOnce([
      { toolCallId: 'call-1', output: '{"status":"ok"}' },
    ]);
    const finalMessage = buildAssistantMessage(undefined, 'feito');
    openaiService.chatCompletion.mockResolvedValueOnce(
      buildCompletion(finalMessage),
    );

    const input = buildInput(initial);
    const result = await runner.run(input);

    expect(toolExecutor.executeMany).toHaveBeenCalledTimes(1);
    expect(toolExecutor.executeMany.mock.calls[0][0]).toEqual([toolCall]);
    expect(confirmationManager.trackPendingConfirmation).toHaveBeenCalledWith({
      conversationId: 'c1',
      toolName: 'create_patient',
      args: { name: 'Maria' },
      output: '{"status":"ok"}',
    });
    expect(input.hooks.memorizeEntitiesFromToolCall).toHaveBeenCalledWith({
      conversationId: 'c1',
      toolName: 'create_patient',
      args: { name: 'Maria' },
      output: '{"status":"ok"}',
    });
    expect(input.hooks.appendNextStepIfNeeded).toHaveBeenCalled();
    expect(input.hooks.redactResidualPii).toHaveBeenCalledWith(input.messages, {
      conversationId: 'c1',
      messageSid: 'sid-1',
    });
    expect(input.hooks.buildToolsForCurrentDraft).toHaveBeenCalledWith('c1');
    expect(input.hooks.buildPromptCacheKey).toHaveBeenCalled();
    expect(telemetry.captureUsageSnapshot).toHaveBeenCalledWith(
      input.usageSnapshots,
      'followup_1',
      expect.anything(),
      expect.any(Number),
      expect.objectContaining({ toolsCount: 0, draftType: null }),
    );
    expect(result.loopLimitReached).toBe(false);
    expect(result.responseMessage).toBe(finalMessage);
  });

  it('appends assistant tool_calls message and tool results to messages', async () => {
    const toolCall = buildToolCall('call-1', 'noop');
    const initial = buildAssistantMessage([toolCall]);
    toolExecutor.executeMany.mockResolvedValueOnce([
      { toolCallId: 'call-1', output: 'result' },
    ]);
    openaiService.chatCompletion.mockResolvedValueOnce(
      buildCompletion(buildAssistantMessage(undefined, 'fim')),
    );

    const input = buildInput(initial);
    await runner.run(input);

    expect(input.messages).toHaveLength(2);
    expect(input.messages[0]).toBe(initial);
    expect(input.messages[1]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-1',
      content: 'result',
    });
  });

  it('blocks plan-first violations and synthesizes blocked tool results', async () => {
    const blocked = buildToolCall('blocked-1', 'create_patient');
    const allowed = buildToolCall('allowed-1', 'plan_actions');
    const initial = buildAssistantMessage([blocked, allowed]);

    toolExecutor.executeMany.mockResolvedValueOnce([
      { toolCallId: 'allowed-1', output: 'plan ok' },
    ]);
    openaiService.chatCompletion.mockResolvedValueOnce(
      buildCompletion(buildAssistantMessage(undefined, 'fim')),
    );

    const hooks = buildHooks({
      evaluatePlanFirstGuard: jest
        .fn()
        .mockResolvedValue(new Set(['blocked-1'])),
    });

    const input = buildInput(initial, { hooks });
    await runner.run(input);

    expect(toolExecutor.executeMany).toHaveBeenCalledWith(
      [allowed],
      expect.anything(),
    );
    const blockedMsg = input.messages.find(
      (m) => (m as any).tool_call_id === 'blocked-1',
    ) as any;
    expect(blockedMsg).toBeDefined();
    expect(blockedMsg.content).toContain('PLAN_ACTIONS_REQUIRED');
  });

  it('skips tool execution when all tool calls are blocked', async () => {
    const blocked = buildToolCall('blocked-1', 'create_patient');
    const initial = buildAssistantMessage([blocked]);
    openaiService.chatCompletion.mockResolvedValueOnce(
      buildCompletion(buildAssistantMessage(undefined, 'corrige')),
    );

    const hooks = buildHooks({
      evaluatePlanFirstGuard: jest
        .fn()
        .mockResolvedValue(new Set(['blocked-1'])),
    });

    const input = buildInput(initial, { hooks });
    await runner.run(input);

    expect(toolExecutor.executeMany).not.toHaveBeenCalled();
    expect(
      input.messages.some((m) => (m as any).tool_call_id === 'blocked-1'),
    ).toBe(true);
  });

  it('skips trackPendingConfirmation when arguments JSON is invalid', async () => {
    const initial = buildAssistantMessage([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'noop', arguments: '{invalid' },
      } as any,
    ]);
    toolExecutor.executeMany.mockResolvedValueOnce([
      { toolCallId: 'call-1', output: 'r' },
    ]);
    openaiService.chatCompletion.mockResolvedValueOnce(
      buildCompletion(buildAssistantMessage(undefined, 'fim')),
    );

    const input = buildInput(initial);
    await runner.run(input);

    expect(confirmationManager.trackPendingConfirmation).not.toHaveBeenCalled();
    expect(input.hooks.appendNextStepIfNeeded).not.toHaveBeenCalled();
  });

  it('replaces output via appendNextStepIfNeeded hook', async () => {
    const initial = buildAssistantMessage([buildToolCall('call-1', 'noop')]);
    toolExecutor.executeMany.mockResolvedValueOnce([
      { toolCallId: 'call-1', output: 'original' },
    ]);
    openaiService.chatCompletion.mockResolvedValueOnce(
      buildCompletion(buildAssistantMessage(undefined, 'fim')),
    );

    const hooks = buildHooks({
      appendNextStepIfNeeded: jest.fn().mockResolvedValue('enriched'),
    });
    const input = buildInput(initial, { hooks });
    await runner.run(input);

    const toolMsg = input.messages.find(
      (m) => (m as any).tool_call_id === 'call-1',
    ) as any;
    expect(toolMsg.content).toBe('enriched');
  });

  it('runs up to MAX_TOOL_ITERATIONS and signals loopLimitReached', async () => {
    const tc = (id: string) => buildToolCall(id, 'noop');
    const initial = buildAssistantMessage([tc('a')]);
    toolExecutor.executeMany.mockResolvedValue([
      { toolCallId: 'a', output: 'r' },
    ]);
    // MAX_TOOL_ITERATIONS = 5 → o follow-up final ainda devolve tool_calls,
    // o que faz o loop atingir o teto. Cada `mockResolvedValueOnce` cobre
    // uma das 5 chamadas de follow-up.
    openaiService.chatCompletion
      .mockResolvedValueOnce(buildCompletion(buildAssistantMessage([tc('b')])))
      .mockResolvedValueOnce(buildCompletion(buildAssistantMessage([tc('c')])))
      .mockResolvedValueOnce(buildCompletion(buildAssistantMessage([tc('d')])))
      .mockResolvedValueOnce(buildCompletion(buildAssistantMessage([tc('e')])))
      .mockResolvedValueOnce(buildCompletion(buildAssistantMessage([tc('f')])));

    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    const result = await runner.run(buildInput(initial));

    expect(openaiService.chatCompletion).toHaveBeenCalledTimes(5);
    expect(result.loopLimitReached).toBe(true);
    expect(result.responseMessage.tool_calls).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AI_LOOP_LIMIT]'),
    );
    warnSpy.mockRestore();
  });

  it('updates activeDraftType and promptCacheKey from hooks between iterations', async () => {
    const initial = buildAssistantMessage([buildToolCall('call-1', 'noop')]);
    toolExecutor.executeMany.mockResolvedValueOnce([
      { toolCallId: 'call-1', output: 'r' },
    ]);
    openaiService.chatCompletion.mockResolvedValueOnce(
      buildCompletion(buildAssistantMessage(undefined, 'fim')),
    );

    const hooks = buildHooks({
      buildToolsForCurrentDraft: jest
        .fn()
        .mockResolvedValue({ tools: [{} as any], draftType: 'sc' as any }),
      buildPromptCacheKey: jest.fn().mockReturnValue('cache:sc'),
    });

    const input = buildInput(initial, { hooks });
    const result = await runner.run(input);

    expect(result.activeDraftType).toBe('sc');
    expect(result.promptCacheKey).toBe('cache:sc');
    expect(openaiService.chatCompletion.mock.calls[0][0].cacheKey).toBe(
      'cache:sc',
    );
  });

  it('captures usage snapshot for each follow-up', async () => {
    const initial = buildAssistantMessage([buildToolCall('a', 'noop')]);
    toolExecutor.executeMany.mockResolvedValue([
      { toolCallId: 'a', output: 'r' },
    ]);
    openaiService.chatCompletion
      .mockResolvedValueOnce(
        buildCompletion(buildAssistantMessage([buildToolCall('b', 'noop')])),
      )
      .mockResolvedValueOnce(
        buildCompletion(buildAssistantMessage(undefined, 'fim')),
      );

    const input = buildInput(initial);
    await runner.run(input);

    const stages = (telemetry.captureUsageSnapshot as jest.Mock).mock.calls.map(
      (c) => c[1],
    );
    expect(stages).toEqual(['followup_1', 'followup_2']);
  });
});
