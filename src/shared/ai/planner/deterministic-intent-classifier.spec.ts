import { DeterministicIntentClassifier } from './deterministic-intent-classifier';
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

describe('DeterministicIntentClassifier', () => {
  const classifier = new DeterministicIntentClassifier();

  it('classifica saudação como smalltalk com alta confiança', () => {
    const r = classifier.classify({ text: 'oi', state: makeState() });
    expect(r.intent).toBe('smalltalk');
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('detecta create_sc por keyword', () => {
    const r = classifier.classify({
      text: 'preciso criar uma sc para a Maria',
      state: makeState(),
    });
    expect(r.intent).toBe('create_sc');
    expect(r.next_tool_candidates).toContain('plan_actions');
  });

  it('extrai TUSS, CID e datas determinísticos', () => {
    const r = classifier.classify({
      text: 'criar SC com TUSS 30602114, CID M17.1, data 2026-06-10',
      state: makeState(),
    });
    expect(r.entities.tuss_hint).toEqual(['30602114']);
    expect(r.entities.cid_hint).toEqual(['M17.1']);
    expect(r.entities.date_hint).toBe('2026-06-10');
  });

  it('"sim" com pendingConfirmation → intent confirm', () => {
    const r = classifier.classify({
      text: 'sim',
      state: makeState({
        pendingConfirmation: {
          tool: 'send_sc_draft_commit',
          argsRedacted: {},
          expiresAt: new Date(Date.now() + 1000).toISOString(),
          instruction: '',
        },
      }),
    });
    expect(r.intent).toBe('confirm');
    expect(r.next_tool_candidates).toContain('send_sc_draft_commit');
  });

  it('"sim" sem pending → smalltalk (não confirm)', () => {
    const r = classifier.classify({ text: 'sim', state: makeState() });
    expect(r.intent).not.toBe('confirm');
  });

  it('dígito 1-3 com numericChoice → numeric_choice', () => {
    const r = classifier.classify({
      text: '2',
      state: makeState({
        numericChoice: { options: ['Enviar', 'Cancelar', 'Detalhes'] },
      }),
    });
    expect(r.intent).toBe('numeric_choice');
  });

  it('texto vazio → unknown needs_clarification', () => {
    const r = classifier.classify({ text: '   ', state: makeState() });
    expect(r.intent).toBe('unknown');
    expect(r.needs_clarification).toBe(true);
  });

  it('SC reference é extraído', () => {
    const r = classifier.classify({
      text: 'detalhes da SC-0042',
      state: makeState(),
    });
    expect(r.entities.surgery_request_ref).toBe('SC-0042');
  });

  it('mensagens de query_sc viram next_tool_candidates correto', () => {
    const r = classifier.classify({
      text: 'me mostra minhas sc',
      state: makeState(),
    });
    expect(r.intent).toBe('query_sc');
    expect(r.next_tool_candidates).toContain('query_surgery_requests');
  });
});
