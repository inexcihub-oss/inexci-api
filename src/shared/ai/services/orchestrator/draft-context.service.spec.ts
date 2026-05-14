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
    it('sempre retorna set vazio (guard no-op)', async () => {
      const toolCalls = [makeToolCall('c1', 'any_mutation_tool')];
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
