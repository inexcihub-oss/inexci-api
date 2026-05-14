import OpenAI from 'openai';
import { Test } from '@nestjs/testing';
import { ToolRegistryService, detectDraftType } from './tool-registry.service';
import { AiTool, AI_TOOL } from '../tools/tool.interface';

/**
 * Cria uma instância do `ToolRegistryService` via `Test.createTestingModule`
 * usando o token `AI_TOOL` com um array de tools fixo.
 *
 * Fase 6 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md` — o registry agora recebe
 * `@Inject(AI_TOOL) allTools: AiTool[]` em vez de 30+ deps individuais.
 *
 * Por padrão também executa o warmup do `definitionsCache` para refletir
 * o comportamento de produção (após `onModuleInit`). Use `warmup: false`
 * para testar especificamente o cache miss path.
 */
async function buildRegistryWithToolsDI(
  tools: AiTool[],
  options: { warmup?: boolean } = {},
): Promise<ToolRegistryService> {
  const { warmup = true } = options;
  const module = await Test.createTestingModule({
    providers: [{ provide: AI_TOOL, useValue: tools }, ToolRegistryService],
  }).compile();
  const registry = module.get(ToolRegistryService);
  if (warmup) registry.onModuleInit();
  return registry;
}

/**
 * Versão síncrona (sem DI) para testes que não precisam do container NestJS.
 * Mantida para compatibilidade com os testes de filtragem que são puramente
 * síncronos e não dependem do construtor real.
 */
function buildRegistryWithTools(
  tools: AiTool[],
  options: { warmup?: boolean } = {},
): ToolRegistryService {
  const { warmup = true } = options;
  const registry = Object.create(
    ToolRegistryService.prototype,
  ) as ToolRegistryService;
  (registry as any).tools = new Map(tools.map((t) => [t.name, t]));
  (registry as any).definitionsCache = new Map();
  (registry as any).logger = { log: jest.fn() };
  if (warmup) registry.onModuleInit();
  return registry;
}

function makeTool(name: string): AiTool {
  return {
    name,
    definition: {
      type: 'function',
      function: { name, description: name, parameters: { type: 'object' } },
    } as OpenAI.ChatCompletionTool,
    execute: async () => '',
  };
}

describe('detectDraftType', () => {
  it('retorna null para tools que não contêm "_draft_" no nome', () => {
    expect(detectDraftType('plan_actions')).toBeNull();
    expect(detectDraftType('query_patients')).toBeNull();
    expect(detectDraftType('query_surgery_requests')).toBeNull();
    expect(detectDraftType('confirm_receipt')).toBeNull();
    expect(detectDraftType('manage_tuss_items')).toBeNull();
  });

  it('mapeia prefixos curtos de drafts de SC e cadastro', () => {
    expect(detectDraftType('sc_draft_set_patient')).toBe('create_sc');
    expect(detectDraftType('patient_draft_set_name')).toBe('create_patient');
    expect(detectDraftType('hospital_draft_commit')).toBe('create_hospital');
    expect(detectDraftType('health_plan_draft_set_name')).toBe(
      'create_health_plan',
    );
    expect(detectDraftType('procedure_draft_preview')).toBe('create_procedure');
  });

  it('mapeia prefixos de fluxos complexos', () => {
    expect(detectDraftType('invoice_draft_set_value')).toBe('invoice');
    expect(detectDraftType('contestation_draft_commit')).toBe('contestation');
    expect(detectDraftType('scheduling_draft_set_confirmed_date')).toBe(
      'scheduling',
    );
    expect(detectDraftType('update_sc_draft_set_field')).toBe('update_sc');
  });

  it('mapeia prefixos de transições de status', () => {
    expect(detectDraftType('send_sc_draft_set_method')).toBe('send_sc');
    expect(detectDraftType('start_analysis_draft_commit')).toBe(
      'start_analysis',
    );
    expect(detectDraftType('accept_authorization_draft_preview')).toBe(
      'accept_authorization',
    );
    expect(detectDraftType('mark_performed_draft_set_performed_at')).toBe(
      'mark_performed',
    );
  });

  it('retorna null para prefixo de draft desconhecido', () => {
    expect(detectDraftType('unknown_prefix_draft_foo')).toBeNull();
  });
});

describe('ToolRegistryService.getToolDefinitionsForDraft', () => {
  it('expõe apenas tools globais quando não há draft ativo', () => {
    const registry = buildRegistryWithTools([
      makeTool('plan_actions'),
      makeTool('query_patients'),
      makeTool('query_surgery_requests'),
      makeTool('sc_draft_set_patient'),
      makeTool('invoice_draft_set_value'),
      makeTool('mark_performed_draft_set_performed_at'),
    ]);
    const defs = registry.getToolDefinitionsForDraft(null);
    const names = defs.map((d) => d.function.name).sort();
    expect(names).toEqual([
      'plan_actions',
      'query_patients',
      'query_surgery_requests',
    ]);
  });

  it('inclui tools globais + tools do draft ativo (create_sc)', () => {
    const registry = buildRegistryWithTools([
      makeTool('plan_actions'),
      makeTool('query_surgery_requests'),
      makeTool('sc_draft_set_patient'),
      makeTool('sc_draft_commit'),
      makeTool('patient_draft_set_name'),
      makeTool('invoice_draft_set_value'),
    ]);
    const defs = registry.getToolDefinitionsForDraft('create_sc');
    const names = defs.map((d) => d.function.name).sort();
    expect(names).toEqual([
      'plan_actions',
      'query_surgery_requests',
      'sc_draft_commit',
      'sc_draft_set_patient',
    ]);
  });

  it('isola tools entre drafts com prefixos parecidos (sc_draft_ vs update_sc_draft_)', () => {
    const registry = buildRegistryWithTools([
      makeTool('plan_actions'),
      makeTool('sc_draft_set_patient'),
      makeTool('update_sc_draft_set_field'),
      makeTool('send_sc_draft_set_request'),
    ]);

    const create = registry
      .getToolDefinitionsForDraft('create_sc')
      .map((d) => d.function.name)
      .sort();
    expect(create).toEqual(['plan_actions', 'sc_draft_set_patient']);

    const update = registry
      .getToolDefinitionsForDraft('update_sc')
      .map((d) => d.function.name)
      .sort();
    expect(update).toEqual(['plan_actions', 'update_sc_draft_set_field']);

    const send = registry
      .getToolDefinitionsForDraft('send_sc')
      .map((d) => d.function.name)
      .sort();
    expect(send).toEqual(['plan_actions', 'send_sc_draft_set_request']);
  });

  it('mantém o total bem abaixo de 128 mesmo somando tools globais com um draft', () => {
    const tools: AiTool[] = [];
    for (let i = 0; i < 50; i++) tools.push(makeTool(`global_tool_${i}`));
    for (let i = 0; i < 12; i++) tools.push(makeTool(`sc_draft_field_${i}`));
    for (let i = 0; i < 30; i++)
      tools.push(makeTool(`invoice_draft_field_${i}`));

    const registry = buildRegistryWithTools(tools);
    const noDraft = registry.getToolDefinitionsForDraft(null).length;
    const withInvoice = registry.getToolDefinitionsForDraft('invoice').length;

    expect(noDraft).toBe(50);
    expect(withInvoice).toBe(50 + 30);
    expect(withInvoice).toBeLessThan(128);
  });

  /**
   * O prompt caching da OpenAI faz hash do prefixo do request (system prompt
   * + tool definitions). Se a ordem das tools muda, o hit rate vai a zero.
   * Este teste é uma "tripwire" — se passar a quebrar, alguém reordenou as
   * tools sem bumpar `PROMPT_VERSION`. Veja Fase 1 do
   * `PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA.md`.
   */
  it('preserva ordem de inserção (tripwire para prompt caching)', () => {
    const insertionOrder = [
      'plan_actions',
      'sc_draft_set_patient',
      'sc_draft_set_procedure',
      'sc_draft_commit',
      'query_surgery_requests',
      'query_patients',
      'invoice_draft_set_value',
      'invoice_draft_commit',
    ];

    const registry = buildRegistryWithTools(insertionOrder.map(makeTool));

    // Sem draft ativo: só as globais, na ordem que foram inseridas.
    expect(
      registry.getToolDefinitionsForDraft(null).map((d) => d.function.name),
    ).toEqual(['plan_actions', 'query_surgery_requests', 'query_patients']);

    // Com draft `create_sc`: globais + as `sc_draft_*`, preservando a ordem
    // relativa de cada grupo conforme inseridas.
    expect(
      registry
        .getToolDefinitionsForDraft('create_sc')
        .map((d) => d.function.name),
    ).toEqual([
      'plan_actions',
      'sc_draft_set_patient',
      'sc_draft_set_procedure',
      'sc_draft_commit',
      'query_surgery_requests',
      'query_patients',
    ]);

    // Com draft `invoice`: globais + as `invoice_draft_*`.
    expect(
      registry
        .getToolDefinitionsForDraft('invoice')
        .map((d) => d.function.name),
    ).toEqual([
      'plan_actions',
      'query_surgery_requests',
      'query_patients',
      'invoice_draft_set_value',
      'invoice_draft_commit',
    ]);
  });

  it('chamadas repetidas devolvem a mesma ordem (estabilidade entre turnos)', () => {
    const registry = buildRegistryWithTools([
      makeTool('plan_actions'),
      makeTool('sc_draft_set_patient'),
      makeTool('sc_draft_commit'),
      makeTool('query_surgery_requests'),
    ]);

    const a = registry
      .getToolDefinitionsForDraft('create_sc')
      .map((d) => d.function.name);
    const b = registry
      .getToolDefinitionsForDraft('create_sc')
      .map((d) => d.function.name);

    expect(a).toEqual(b);
  });
});

// ─── Fase 6 — Auto-registro via token AI_TOOL ─────────────────────────────────

describe('ToolRegistryService (Fase 6 — DI via AI_TOOL)', () => {
  it('instancia corretamente via Test.createTestingModule com provider AI_TOOL', async () => {
    const tools = [
      makeTool('plan_actions'),
      makeTool('sc_draft_commit'),
      makeTool('query_surgery_requests'),
    ];

    const registry = await buildRegistryWithToolsDI(tools);

    const allDefs = registry.getToolDefinitions();
    expect(allDefs).toHaveLength(3);
    expect(allDefs.map((d) => d.function.name)).toEqual([
      'plan_actions',
      'sc_draft_commit',
      'query_surgery_requests',
    ]);
  });

  it('preserva a ordem de inserção do array AI_TOOL injetado (tripwire para prompt caching)', async () => {
    const insertionOrder = [
      'plan_actions',
      'sc_draft_preview',
      'sc_draft_commit',
      'invoice_draft_preview',
      'invoice_draft_commit',
      'query_surgery_requests',
      'manage_tuss_items',
      'draft_update',
      'draft_status',
      'draft_cancel',
    ];

    const registry = await buildRegistryWithToolsDI(
      insertionOrder.map(makeTool),
    );

    expect(registry.getToolDefinitions().map((d) => d.function.name)).toEqual(
      insertionOrder,
    );
  });

  it('filtragem por draft ativo funciona corretamente após DI', async () => {
    const tools = [
      makeTool('plan_actions'),
      makeTool('sc_draft_commit'),
      makeTool('invoice_draft_commit'),
      makeTool('draft_update'),
    ];

    const registry = await buildRegistryWithToolsDI(tools);

    const noDraft = registry
      .getToolDefinitionsForDraft(null)
      .map((d) => d.function.name);
    expect(noDraft).toEqual(['plan_actions']);

    const withScDraft = registry
      .getToolDefinitionsForDraft('create_sc')
      .map((d) => d.function.name);
    expect(withScDraft).toEqual([
      'plan_actions',
      'sc_draft_commit',
      'draft_update',
    ]);

    const withInvoice = registry
      .getToolDefinitionsForDraft('invoice')
      .map((d) => d.function.name);
    expect(withInvoice).toEqual([
      'plan_actions',
      'invoice_draft_commit',
      'draft_update',
    ]);
  });

  it('construtor recebe array vazio sem erros (zero tools)', async () => {
    const registry = await buildRegistryWithToolsDI([]);
    expect(registry.getToolDefinitions()).toHaveLength(0);
    expect(registry.getToolDefinitionsForDraft(null)).toHaveLength(0);
  });
});

describe('ToolRegistryService.definitionsCache (Fase 2 — memoização)', () => {
  it('onModuleInit pré-popula o cache para todas as chaves possíveis (none + 13 drafts)', () => {
    const registry = buildRegistryWithTools(
      [
        makeTool('plan_actions'),
        makeTool('sc_draft_set_patient'),
        makeTool('invoice_draft_set_value'),
      ],
      { warmup: false },
    );

    const cacheBefore = (registry as any).definitionsCache as Map<
      string,
      unknown
    >;
    expect(cacheBefore.size).toBe(0);

    registry.onModuleInit();

    const cacheAfter = (registry as any).definitionsCache as Map<
      string,
      unknown
    >;
    // 1 chave 'none' + 13 OperationDraftType distintos.
    expect(cacheAfter.size).toBe(14);
    expect(cacheAfter.has('none')).toBe(true);
    expect(cacheAfter.has('create_sc')).toBe(true);
    expect(cacheAfter.has('invoice')).toBe(true);
    expect(cacheAfter.has('mark_performed')).toBe(true);
  });

  it('chamadas repetidas devolvem a MESMA REFERÊNCIA do array (não realoca)', () => {
    const registry = buildRegistryWithTools([
      makeTool('plan_actions'),
      makeTool('sc_draft_set_patient'),
      makeTool('sc_draft_commit'),
    ]);

    const ref1 = registry.getToolDefinitionsForDraft('create_sc');
    const ref2 = registry.getToolDefinitionsForDraft('create_sc');
    const ref3 = registry.getToolDefinitionsForDraft(null);
    const ref4 = registry.getToolDefinitionsForDraft(null);

    expect(ref1).toBe(ref2);
    expect(ref3).toBe(ref4);
    expect(ref1).not.toBe(ref3);
  });

  it('cache miss: registry sem warmup popula sob demanda na primeira chamada', () => {
    const registry = buildRegistryWithTools(
      [makeTool('plan_actions'), makeTool('sc_draft_set_patient')],
      { warmup: false },
    );

    const cache = (registry as any).definitionsCache as Map<string, unknown>;
    expect(cache.size).toBe(0);

    const ref1 = registry.getToolDefinitionsForDraft('create_sc');
    expect(cache.size).toBe(1);
    expect(cache.get('create_sc')).toBe(ref1);

    // Segunda chamada usa o que foi memoizado.
    const ref2 = registry.getToolDefinitionsForDraft('create_sc');
    expect(ref1).toBe(ref2);
    expect(cache.size).toBe(1);
  });
});
