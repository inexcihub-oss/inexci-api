import { mergeConversationMemory } from './conversation-memory-merger';

describe('mergeConversationMemory', () => {
  it('preserva pending_confirmation quando patch não menciona', () => {
    const base = {
      pending_confirmation: {
        tool: 'send_sc_draft_commit',
        args: { id: 'sc-1' },
        description: 'enviar',
        createdAt: '2026-05-14T00:00:00Z',
      },
      patient: { id: 'p-1' },
    };
    const patch = { intent: 'create_sc' };
    const merged = mergeConversationMemory(base as any, patch as any);
    expect(merged.pending_confirmation?.tool).toBe('send_sc_draft_commit');
    expect(merged.intent).toBe('create_sc');
    expect(merged.patient?.id).toBe('p-1');
  });

  it('null no patch significa "manter atual"', () => {
    const base = { intent: 'create_sc' };
    const merged = mergeConversationMemory(base as any, { intent: null } as any);
    expect(merged.intent).toBe('create_sc');
  });

  it('arrays de strings são unidas com Set', () => {
    const base = { confirmed_facts: ['a', 'b'] };
    const merged = mergeConversationMemory(base as any, {
      confirmed_facts: ['b', 'c'],
    } as any);
    expect(merged.confirmed_facts?.sort()).toEqual(['a', 'b', 'c']);
  });

  it('objetos aninhados são merged recursivamente', () => {
    const base = { surgeryRequest: { id: 'sc-1', hospital: 'H1' } };
    const merged = mergeConversationMemory(base as any, {
      surgeryRequest: { healthPlan: 'P1' },
    } as any);
    expect(merged.surgeryRequest?.id).toBe('sc-1');
    expect(merged.surgeryRequest?.hospital).toBe('H1');
    expect(merged.surgeryRequest?.healthPlan).toBe('P1');
  });

  it('valores primitivos no patch sobrescrevem', () => {
    const base = { intent: 'old' };
    const merged = mergeConversationMemory(base as any, { intent: 'new' } as any);
    expect(merged.intent).toBe('new');
  });

  it('base nula = patch puro', () => {
    const merged = mergeConversationMemory(null, { intent: 'x' } as any);
    expect(merged.intent).toBe('x');
  });
});
