import { PlannerService } from './planner.service';
import { DeterministicIntentClassifier } from './deterministic-intent-classifier';
import { PlannerLlmService } from './planner-llm.service';
import { OperationalState } from '../state/operational-state.types';

function makeState(overrides: Partial<OperationalState> = {}): OperationalState {
  return {
    turn: {
      phoneMasked: '***1',
      userId: 'u',
      userName: null,
      userRole: null,
      isDoctor: false,
      ownerId: null,
      selfDoctorId: null,
      doctorIdsAccessible: [],
      channel: 'whatsapp',
    },
    activeWorkflow: null,
    lastAction: null,
    pendingConfirmation: null,
    awaitingMedia: null,
    multimodalContext: { docPending: null, audioPending: null },
    numericChoice: null,
    ...overrides,
  };
}

describe('PlannerService', () => {
  it('intent simples (smalltalk) NÃO chama LLM', async () => {
    const llm = { plan: jest.fn() } as unknown as PlannerLlmService;
    const planner = new PlannerService(
      new DeterministicIntentClassifier(),
      llm,
    );
    const result = await planner.plan({
      text: 'oi',
      state: makeState(),
    });
    expect(result.intent).toBe('smalltalk');
    expect(result.source).toBe('deterministic');
    expect(llm.plan).not.toHaveBeenCalled();
  });

  it('intent unknown (low confidence) chama o LLM', async () => {
    const llmFake = {
      plan: jest.fn().mockResolvedValue({
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
        source: 'llm',
      }),
    } as unknown as PlannerLlmService;
    const planner = new PlannerService(
      new DeterministicIntentClassifier(),
      llmFake,
    );
    const result = await planner.plan({
      text: 'frase complicada que ninguém entende',
      state: makeState(),
    });
    expect(llmFake.plan).toHaveBeenCalled();
    expect(result.source).toBe('hybrid');
    expect(result.intent).toBe('create_sc');
  });

  it('forceLlm sempre chama o LLM mesmo em smalltalk', async () => {
    const llmFake = {
      plan: jest.fn().mockResolvedValue({
        intent: 'help',
        confidence: 0.9,
        active_workflow_continuation: false,
        active_workflow: null,
        entities: {},
        next_tool_candidates: [],
        missing_fields: [],
        risk: 'low',
        needs_clarification: false,
        fallback_strategy: 'noop',
        source: 'llm',
      }),
    } as unknown as PlannerLlmService;
    const planner = new PlannerService(
      new DeterministicIntentClassifier(),
      llmFake,
    );
    await planner.plan({
      text: 'oi',
      state: makeState(),
      forceLlm: true,
    });
    expect(llmFake.plan).toHaveBeenCalled();
  });

  it('deterministicOnly NUNCA chama LLM mesmo em casos ambíguos', async () => {
    const llmFake = { plan: jest.fn() } as unknown as PlannerLlmService;
    const planner = new PlannerService(
      new DeterministicIntentClassifier(),
      llmFake,
    );
    const result = await planner.plan({
      text: '???',
      state: makeState(),
      deterministicOnly: true,
    });
    expect(llmFake.plan).not.toHaveBeenCalled();
    expect(result.source).toBe('deterministic');
  });
});
