import { ToolSubsetSelector } from './tool-subset-selector';
import { ToolRegistryService } from '../services/tool-registry.service';
import OpenAI from 'openai';
import { PlanResult } from './planner.types';

function makeTool(name: string): OpenAI.ChatCompletionTool {
  return {
    type: 'function',
    function: { name, parameters: {} as any },
  } as OpenAI.ChatCompletionTool;
}

function makePlan(overrides: Partial<PlanResult> = {}): PlanResult {
  return {
    intent: 'create_sc',
    confidence: 0.9,
    active_workflow_continuation: false,
    active_workflow: null,
    entities: {},
    next_tool_candidates: ['plan_actions'],
    missing_fields: [],
    risk: 'medium',
    needs_clarification: false,
    fallback_strategy: 'noop',
    source: 'deterministic',
    ...overrides,
  };
}

describe('ToolSubsetSelector', () => {
  const fullSet = [
    makeTool('plan_actions'),
    makeTool('draft_status'),
    makeTool('draft_cancel'),
    makeTool('draft_update'),
    makeTool('sc_draft_preview'),
    makeTool('sc_draft_commit'),
    makeTool('query_surgery_requests'),
    makeTool('search_tuss_codes'),
    makeTool('manage_documents'),
    makeTool('upload_doctor_signature'),
  ];

  function buildSelector(): { sel: ToolSubsetSelector; reg: ToolRegistryService } {
    const reg = {
      getToolDefinitionsForDraft: jest.fn().mockReturnValue(fullSet),
    } as unknown as ToolRegistryService;
    return { sel: new ToolSubsetSelector(reg), reg };
  }

  it('inclui ALWAYS_INCLUDE + lookup tools mesmo sem candidatos do plan', () => {
    const { sel } = buildSelector();
    const r = sel.select({
      plan: makePlan({ intent: 'smalltalk', next_tool_candidates: [] }),
      activeDraftType: null,
    });
    const names = r.map((t) => (t as any).function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'plan_actions',
        'draft_status',
        'draft_cancel',
        'draft_update',
        'query_surgery_requests',
        'search_tuss_codes',
      ]),
    );
    expect(names).not.toContain('manage_documents');
  });

  it('inclui draft tools quando draft ativo', () => {
    const { sel } = buildSelector();
    const r = sel.select({
      plan: makePlan(),
      activeDraftType: 'create_sc',
    });
    const names = r.map((t) => (t as any).function.name);
    expect(names).toEqual(
      expect.arrayContaining(['sc_draft_preview', 'sc_draft_commit']),
    );
  });

  it('bypass=true devolve full set sem filtro', () => {
    const { sel } = buildSelector();
    const r = sel.select({
      plan: makePlan({ next_tool_candidates: [] }),
      activeDraftType: null,
      bypass: true,
    });
    expect(r).toHaveLength(fullSet.length);
  });

  it('quando subset ficaria vazio, retorna full set como fallback', () => {
    const reg = {
      getToolDefinitionsForDraft: jest.fn().mockReturnValue([
        makeTool('weird_tool_no_match'),
      ]),
    } as unknown as ToolRegistryService;
    const sel = new ToolSubsetSelector(reg);
    const r = sel.select({
      plan: makePlan({ next_tool_candidates: ['inexistente'] }),
      activeDraftType: null,
    });
    expect(r).toHaveLength(1);
  });
});
