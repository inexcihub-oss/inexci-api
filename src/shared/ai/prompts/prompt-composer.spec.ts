import { OperationalStateBuilder } from '../state/operational-state.builder';
import { PromptComposer } from './prompt-composer';
import { CORE_PROMPT, CORE_PROMPT_VERSION } from './core.prompt';
import { WhatsappConversation } from '../../../database/entities/whatsapp-conversation.entity';
import {
  OperationDraft,
  OperationDraftType,
} from '../drafts/operation-draft.types';

function makeConversation(
  overrides: Partial<WhatsappConversation> = {},
): WhatsappConversation {
  return {
    id: 'conv-1',
    phone: '+551199999999',
    userId: 'user-1',
    startedAt: new Date(),
    lastMessageAt: new Date(),
    ownerId: 'owner-1',
    conversationSummary: null,
    conversationMemory: {},
    operationDraft: null,
    summaryUpdatedAt: null,
    summaryVersion: 1,
    active: true,
    ...overrides,
  } as unknown as WhatsappConversation;
}

function makeDraft<T extends OperationDraftType>(
  type: T,
  fields: Record<string, unknown> = {},
): OperationDraft {
  return {
    type,
    startedAt: '2026-05-14T00:00:00Z',
    updatedAt: '2026-05-14T00:00:00Z',
    status: 'collecting',
    fields: fields as any,
  } as OperationDraft;
}

describe('PromptComposer', () => {
  const builder = new OperationalStateBuilder();
  const composer = new PromptComposer(builder);
  const baseUser = {
    id: 'u',
    name: null,
    role: null,
    isDoctor: false,
    ownerId: null,
    selfDoctorId: null,
    accessibleDoctorIds: [],
  };

  it('compose sem workflow → 2 systems (core + state)', () => {
    const state = builder.build({
      conversation: makeConversation(),
      user: baseUser,
      phoneMasked: '***1',
    });
    const out = composer.compose(state);
    expect(out.systemMessages).toHaveLength(2);
    expect(out.systemMessages[0].content).toBe(CORE_PROMPT);
    expect(out.systemMessages[1].content).toMatch(/^OPERATIONAL_STATE:/);
    expect(out.cacheKey).toContain(`v${CORE_PROMPT_VERSION}`);
    expect(out.cacheKey).toContain('wf=none');
  });

  it('compose com create_sc → 3 systems (core + módulo + state)', () => {
    const state = builder.build({
      conversation: makeConversation({
        operationDraft: makeDraft('create_sc'),
      }),
      user: baseUser,
      phoneMasked: '***1',
    });
    const out = composer.compose(state);
    expect(out.systemMessages).toHaveLength(3);
    expect(out.systemMessages[1].content).toMatch(/WORKFLOW ATIVO: create_sc/);
    expect(out.cacheKey).toContain('wf=create_sc');
  });

  it('compose com docPending injeta módulo multimodal', () => {
    const state = builder.build({
      conversation: makeConversation(),
      user: baseUser,
      phoneMasked: '***1',
      docPending: {
        intent: 'create_sc',
        ocrConfidence: 0.8,
        classifierKind: 'guia_sp_sadt',
        extractedSummary: 'TUSS 30602114',
      },
    });
    const out = composer.compose(state);
    const hasMultimodal = out.systemMessages.some((m) =>
      String(m.content).includes('DOCUMENTO PENDENTE'),
    );
    expect(hasMultimodal).toBe(true);
    expect(out.cacheKey).toContain('doc=guia_sp_sadt');
  });

  it('compose é estável — mesma entrada = mesmo cacheKey', () => {
    const input = {
      conversation: makeConversation({
        operationDraft: makeDraft('invoice'),
      }),
      user: baseUser,
      phoneMasked: '***1',
    };
    const a = composer.compose(builder.build(input));
    const b = composer.compose(builder.build(input));
    expect(a.cacheKey).toBe(b.cacheKey);
  });

  it('core prompt tem ≤ 50 linhas', () => {
    expect(CORE_PROMPT.split('\n').length).toBeLessThanOrEqual(50);
  });
});
