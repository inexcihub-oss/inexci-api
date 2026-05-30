import { OperationalStateBuilder } from './operational-state.builder';
import {
  OperationDraft,
  OperationDraftType,
} from '../drafts/operation-draft.types';
import { WhatsappConversation } from '../../../database/entities/whatsapp-conversation.entity';

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
  fields: Record<string, unknown>,
): OperationDraft {
  return {
    type,
    startedAt: '2026-05-14T00:00:00Z',
    updatedAt: '2026-05-14T00:00:00Z',
    status: 'collecting',
    fields: fields as any,
  } as OperationDraft;
}

describe('OperationalStateBuilder', () => {
  const builder = new OperationalStateBuilder();
  const baseUser = {
    id: 'user-1',
    name: 'Dr. Teste',
    role: 'admin' as const,
    isDoctor: true,
    ownerId: 'owner-1',
    selfDoctorId: 'doctor-1',
    accessibleDoctorIds: ['doctor-1'],
  };

  it('build produz estado mínimo sem draft / sem multimodal', () => {
    const state = builder.build({
      conversation: makeConversation(),
      user: baseUser,
      phoneMasked: '***9999',
    });

    expect(state.activeWorkflow).toBeNull();
    expect(state.lastAction).toBeNull();
    expect(state.pendingConfirmation).toBeNull();
    expect(state.multimodalContext.docPending).toBeNull();
    expect(state.multimodalContext.audioPending).toBeNull();
    expect(state.numericChoice).toBeNull();
    expect(state.turn.userName).toBe('Dr. Teste');
    expect(state.turn.channel).toBe('whatsapp');
  });

  it('build com draft popula fieldsFilled e fieldsPending', () => {
    const draft = makeDraft('create_sc', {
      patientId: 'p-1',
      doctorId: 'd-1',
      procedureId: null,
      priority: 'LOW',
    });
    const state = builder.build({
      conversation: makeConversation({ operationDraft: draft }),
      user: baseUser,
      phoneMasked: '***1',
    });
    expect(state.activeWorkflow?.name).toBe('create_sc');
    expect(state.activeWorkflow?.fieldsFilled).toEqual(
      expect.arrayContaining(['patientId', 'doctorId', 'priority']),
    );
    expect(state.activeWorkflow?.fieldsPending).toEqual(['procedureId']);
  });

  it('pendingConfirmation expira após 15 min', () => {
    const old = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const state = builder.build({
      conversation: makeConversation({
        conversationMemory: {
          pending_confirmation: {
            tool: 'send_sc_draft_commit',
            args: { id: 'sc-1' },
            description: 'enviar',
            createdAt: old,
          },
        },
      }),
      user: baseUser,
      phoneMasked: '***1',
    });
    expect(state.pendingConfirmation).toBeNull();
  });

  it('pendingConfirmation redaciona campos sensíveis', () => {
    const state = builder.build({
      conversation: makeConversation({
        conversationMemory: {
          pending_confirmation: {
            tool: 'create_patient_draft_commit',
            args: { name: 'Maria', cpf: '12345678909', email: 'a@b.com' },
            description: 'criar paciente',
            createdAt: new Date().toISOString(),
          },
        },
      }),
      user: baseUser,
      phoneMasked: '***1',
    });
    expect(state.pendingConfirmation?.argsRedacted.name).toBe('Maria');
    expect(state.pendingConfirmation?.argsRedacted.cpf).toBe('<redacted>');
    expect(state.pendingConfirmation?.argsRedacted.email).toBe('<redacted>');
  });

  it('serialize prefixa OPERATIONAL_STATE: e é determinístico', () => {
    const state = builder.build({
      conversation: makeConversation(),
      user: baseUser,
      phoneMasked: '***1',
    });
    const a = builder.serialize(state);
    const b = builder.serialize(state);
    expect(a).toBe(b);
    expect(a.startsWith('OPERATIONAL_STATE: {')).toBe(true);
  });

  it('cacheKey muda com workflow e doc kind', () => {
    const noWf = builder.cacheKey(
      builder.build({
        conversation: makeConversation(),
        user: baseUser,
        phoneMasked: '***1',
      }),
    );
    const wf = builder.cacheKey(
      builder.build({
        conversation: makeConversation({
          operationDraft: makeDraft('create_sc', { patientId: 'p' }),
        }),
        user: baseUser,
        phoneMasked: '***1',
      }),
    );
    expect(noWf).not.toBe(wf);
  });
});
