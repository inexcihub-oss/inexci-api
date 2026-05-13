import { DraftContextService } from './draft-context.service';
import { OperationDraftService } from '../operation-draft.service';
import { ToolRegistryService } from '../tool-registry.service';
import { ConfigService } from '@nestjs/config';
import { OperationDraftType } from '../../drafts/operation-draft.types';
import { PROMPT_VERSION } from '../../prompts/system-prompt';

const makeToolCall = (
  id: string,
  name: string,
): import('openai').default.ChatCompletionMessageToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: '{}' },
});

describe('DraftContextService', () => {
  let service: DraftContextService;
  let operationDraftService: jest.Mocked<
    Pick<OperationDraftService, 'getCurrent'>
  >;
  let toolRegistry: jest.Mocked<
    Pick<ToolRegistryService, 'getToolDefinitionsForDraft'>
  >;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(() => {
    operationDraftService = {
      getCurrent: jest.fn().mockResolvedValue(null),
    };
    toolRegistry = {
      getToolDefinitionsForDraft: jest.fn().mockReturnValue([]),
    };
    configService = {
      get: jest.fn().mockImplementation((key: string, def: unknown) => {
        if (key === 'AI_USE_DRAFT_FLOWS') return 'true';
        return def;
      }),
    };
    service = new DraftContextService(
      operationDraftService as unknown as OperationDraftService,
      toolRegistry as unknown as ToolRegistryService,
      configService as unknown as ConfigService,
    );
  });

  describe('evaluatePlanFirstGuard', () => {
    it('retorna set vazio quando plan_actions foi chamado no mesmo turno', async () => {
      const toolCalls = [makeToolCall('c1', 'plan_actions')];
      const result = await service.evaluatePlanFirstGuard(toolCalls, 'conv-1');
      expect(result.size).toBe(0);
    });

    it('retorna set vazio quando COMPLEX_MUTATION_TOOL_NAMES está vazio (sub-fase 3.9)', async () => {
      const toolCalls = [makeToolCall('c1', 'any_mutation_tool')];
      const result = await service.evaluatePlanFirstGuard(toolCalls, 'conv-1');
      expect(result.size).toBe(0);
    });

    it('retorna set vazio quando AI_USE_DRAFT_FLOWS não é true', async () => {
      configService.get.mockImplementation((key: string, def: unknown) => {
        if (key === 'AI_USE_DRAFT_FLOWS') return 'false';
        return def;
      });
      const toolCalls = [makeToolCall('c1', 'advance_surgery_request')];
      const result = await service.evaluatePlanFirstGuard(toolCalls, 'conv-1');
      expect(result.size).toBe(0);
    });

    it('retorna set vazio quando draft ativo já existe (plan_actions foi chamado antes)', async () => {
      operationDraftService.getCurrent.mockResolvedValue({
        type: 'sc_create' as OperationDraftType,
      } as any);
      const toolCalls = [makeToolCall('c1', 'advance_surgery_request')];
      const result = await service.evaluatePlanFirstGuard(toolCalls, 'conv-1');
      expect(result.size).toBe(0);
    });

    it('retorna set vazio quando toolCalls está vazio', async () => {
      const result = await service.evaluatePlanFirstGuard([], 'conv-1');
      expect(result.size).toBe(0);
    });
  });

  describe('buildCacheKey', () => {
    it('inclui PROMPT_VERSION e draft=none quando sem draft', () => {
      const key = service.buildCacheKey(null);
      expect(key).toContain(`v${PROMPT_VERSION}`);
      expect(key).toContain('draft=none');
    });

    it('inclui o tipo de draft quando há draft ativo', () => {
      const key = service.buildCacheKey('sc_create' as OperationDraftType);
      expect(key).toContain('draft=sc_create');
    });
  });

  describe('buildToolsForDraft', () => {
    it('retorna tools globais quando não há draft ativo', async () => {
      operationDraftService.getCurrent.mockResolvedValue(null);
      toolRegistry.getToolDefinitionsForDraft.mockReturnValue([] as any);

      const result = await service.buildToolsForDraft('conv-1');

      expect(result.draftType).toBeNull();
      expect(toolRegistry.getToolDefinitionsForDraft).toHaveBeenCalledWith(
        null,
      );
    });

    it('retorna ferramentas do draft ativo quando existe', async () => {
      operationDraftService.getCurrent.mockResolvedValue({
        type: 'sc_create' as OperationDraftType,
      } as any);

      await service.buildToolsForDraft('conv-1');

      expect(toolRegistry.getToolDefinitionsForDraft).toHaveBeenCalledWith(
        'sc_create',
      );
    });
  });
});
