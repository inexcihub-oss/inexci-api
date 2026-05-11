import { OperationDraftService } from './operation-draft.service';
import { WhatsappConversation } from '../../../database/entities/whatsapp-conversation.entity';

describe('OperationDraftService', () => {
  let service: OperationDraftService;
  let storedConversation: Partial<WhatsappConversation>;
  let mockRepo: any;

  beforeEach(() => {
    storedConversation = {
      id: 'conv-1',
      operationDraft: null,
    } as any;
    mockRepo = {
      findOne: jest
        .fn()
        .mockImplementation(async () => storedConversation as any),
      update: jest.fn().mockImplementation(async (id: string, patch: any) => {
        storedConversation = { ...storedConversation, ...patch };
      }),
    };
    service = new OperationDraftService(mockRepo as any);
  });

  it('start cria um draft do tipo informado em status collecting', async () => {
    const draft = await service.start({
      conversationId: 'conv-1',
      type: 'create_sc',
    });
    expect(draft.type).toBe('create_sc');
    expect(draft.status).toBe('collecting');
    expect(draft.fields).toEqual({});
    expect(storedConversation.operationDraft).toEqual(draft);
  });

  it('setField popula campo e atualiza updatedAt', async () => {
    await service.start({ conversationId: 'conv-1', type: 'create_sc' });
    const updated = await service.setField(
      'conv-1',
      'create_sc',
      'patientId',
      'pat-uuid',
    );
    expect(updated.fields.patientId).toBe('pat-uuid');
  });

  it('setField auto-cria o draft quando ainda não existir', async () => {
    const updated = await service.setField(
      'conv-1',
      'create_patient',
      'name',
      'Beatriz Helena',
    );
    expect(updated.type).toBe('create_patient');
    expect(updated.fields.name).toBe('Beatriz Helena');
  });

  it('validate retorna isReady=false quando faltam campos obrigatórios', async () => {
    await service.start({ conversationId: 'conv-1', type: 'create_sc' });
    const result = await service.validate('conv-1', 'create_sc');
    expect(result.isReady).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining([
        'patientId',
        'doctorId',
        'procedureId',
        'priority',
      ]),
    );
  });

  it('validate retorna isReady=true quando todos os obrigatórios estão preenchidos', async () => {
    await service.setFields('conv-1', 'create_sc', {
      patientId: 'p',
      doctorId: 'd',
      procedureId: 'pr',
      priority: 'MEDIUM',
    });
    const result = await service.validate('conv-1', 'create_sc');
    expect(result.isReady).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('getPreview gera texto formatado e seta pending_confirmation', async () => {
    await service.setFields('conv-1', 'create_sc', {
      patientId: 'p',
      patientLabel: 'Beatriz Helena Santos',
      doctorId: 'd',
      doctorLabel: 'Dr. Carlos',
      procedureId: 'pr',
      procedureLabel: 'Artroplastia total do joelho',
      priority: 'MEDIUM',
    });
    const { text, draft } = await service.getPreview('conv-1', 'create_sc');
    expect(text).toContain('Beatriz Helena Santos');
    expect(text).toContain('Artroplastia');
    expect(text).toContain('"sim"');
    expect(draft?.status).toBe('pending_confirmation');
  });

  it('cancel remove o draft', async () => {
    await service.start({ conversationId: 'conv-1', type: 'create_sc' });
    await service.cancel('conv-1');
    const current = await service.getCurrent('conv-1');
    expect(current).toBeNull();
  });

  it('finalizeCommit sem parent limpa o draft', async () => {
    await service.start({ conversationId: 'conv-1', type: 'create_sc' });
    const result = await service.finalizeCommit('conv-1', {
      id: 'sc-new',
      label: 'SC-0042',
    });
    expect(result).toBeNull();
    const current = await service.getCurrent('conv-1');
    expect(current).toBeNull();
  });

  it('finalizeCommit com parent retoma pai e injeta returnField', async () => {
    // Cenário: create_patient aberto como sub-draft de create_sc.
    const parentSnapshot = {
      type: 'create_sc',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'collecting',
      fields: { procedureId: 'pr-1' },
    };

    storedConversation.operationDraft = {
      type: 'create_patient',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'collecting',
      fields: { name: 'Novo Paciente' },
      parent: {
        type: 'create_sc',
        returnField: 'patientId',
        snapshot: parentSnapshot,
      },
    } as any;

    const result = await service.finalizeCommit('conv-1', {
      id: 'pat-new',
      label: 'Novo Paciente',
    });

    expect(result?.type).toBe('create_sc');
    expect((result as any)?.fields.patientId).toBe('pat-new');
    expect((result as any)?.fields.patientLabel).toBe('Novo Paciente');
  });

  it('getCurrentOfType filtra por tipo', async () => {
    await service.start({ conversationId: 'conv-1', type: 'create_patient' });
    const wrong = await service.getCurrentOfType('conv-1', 'create_sc');
    expect(wrong).toBeNull();
    const right = await service.getCurrentOfType('conv-1', 'create_patient');
    expect(right?.type).toBe('create_patient');
  });
});
