import { DraftContextService } from './draft-context.service';
import { OperationDraftService } from '../operation-draft.service';
import { ToolRegistryService } from '../tool-registry.service';
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

  beforeEach(() => {
    operationDraftService = {
      getCurrent: jest.fn().mockResolvedValue(null),
    };
    toolRegistry = {
      getToolDefinitionsForDraft: jest.fn().mockReturnValue([]),
    };
    service = new DraftContextService(
      operationDraftService as unknown as OperationDraftService,
      toolRegistry as unknown as ToolRegistryService,
    );
  });

  describe('evaluatePlanFirstGuard', () => {
    it('retorna set vazio quando toolCalls está vazio', async () => {
      const result = await service.evaluatePlanFirstGuard([], 'conv-1');
      expect(result.size).toBe(0);
    });

    it('não bloqueia tools fora de draft (advance, set_*, manage_*)', async () => {
      operationDraftService.getCurrent.mockResolvedValue(null);
      const toolCalls = [
        makeToolCall('c1', 'advance_surgery_request'),
        makeToolCall('c2', 'set_has_opme'),
        makeToolCall('c3', 'manage_documents'),
      ];
      const result = await service.evaluatePlanFirstGuard(toolCalls, 'conv-1');
      expect(result.size).toBe(0);
    });

    it('não bloqueia plan_actions nunca', async () => {
      operationDraftService.getCurrent.mockResolvedValue(null);
      const result = await service.evaluatePlanFirstGuard(
        [makeToolCall('c1', 'plan_actions')],
        'conv-1',
      );
      expect(result.size).toBe(0);
    });

    it('bloqueia *_draft_commit quando NÃO há draft ativo (retorna call.id)', async () => {
      operationDraftService.getCurrent.mockResolvedValue(null);
      const result = await service.evaluatePlanFirstGuard(
        [makeToolCall('call-1', 'sc_draft_commit')],
        'conv-1',
      );
      expect(result.has('call-1')).toBe(true);
    });

    it('bloqueia *_draft_preview quando draft ativo é de OUTRO tipo', async () => {
      operationDraftService.getCurrent.mockResolvedValue({
        type: 'create_sc' as OperationDraftType,
      } as any);
      const result = await service.evaluatePlanFirstGuard(
        [makeToolCall('call-1', 'invoice_draft_preview')],
        'conv-1',
      );
      expect(result.has('call-1')).toBe(true);
    });

    it('NÃO bloqueia *_draft_commit quando draft ativo é do tipo correto', async () => {
      operationDraftService.getCurrent.mockResolvedValue({
        type: 'create_sc' as OperationDraftType,
      } as any);
      const result = await service.evaluatePlanFirstGuard(
        [makeToolCall('c1', 'sc_draft_commit')],
        'conv-1',
      );
      expect(result.size).toBe(0);
    });

    it('quando getCurrent falha, NÃO bloqueia (falha-segura)', async () => {
      operationDraftService.getCurrent.mockRejectedValue(new Error('db down'));
      const result = await service.evaluatePlanFirstGuard(
        [makeToolCall('c1', 'sc_draft_commit')],
        'conv-1',
      );
      expect(result.size).toBe(0);
    });

    it('options.enabled=false desliga o guard (compat com AI_PLANNER_V3=false)', async () => {
      operationDraftService.getCurrent.mockResolvedValue(null);
      const result = await service.evaluatePlanFirstGuard(
        [makeToolCall('c1', 'sc_draft_commit')],
        'conv-1',
        { enabled: false },
      );
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
