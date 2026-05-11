import { buildPlanTools } from './plan.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { parseToolResult } from './tool-result';
import { ToolContext } from './tool.interface';

describe('plan_actions tool', () => {
  let mockRepo: any;
  let draftService: OperationDraftService;
  let storedConversation: any;
  const context: ToolContext = {
    userId: 'user-1',
    phone: '+5511999999999',
    accessibleDoctorIds: ['doctor-1'],
    conversationId: 'conv-1',
  };

  beforeEach(() => {
    storedConversation = { id: 'conv-1', operationDraft: null };
    mockRepo = {
      findOne: jest.fn().mockImplementation(async () => storedConversation),
      update: jest.fn().mockImplementation(async (_id: string, patch: any) => {
        storedConversation = { ...storedConversation, ...patch };
      }),
    };
    draftService = new OperationDraftService(mockRepo);
  });

  const getTool = () => buildPlanTools(draftService)[0];

  it('abre draft de create_sc para intent create_sc', async () => {
    const tool = getTool();
    const raw = await tool.execute(
      {
        intent: 'create_sc',
        mentioned_entities: {
          patient: 'Beatriz Helena',
          procedure: 'artroplastia',
          hospital: 'Albert Einstein',
        },
        plan_steps: ['verificar paciente', 'verificar procedimento'],
      },
      context,
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.status).toBe('ok');
    expect(parsed?.data.intent).toBe('create_sc');
    expect(parsed?.data.draft_type).toBe('create_sc');
    expect(parsed?.data.draft_started).toBe(true);
    expect(parsed?.next_required_fields).toEqual(
      expect.arrayContaining([
        'patientId',
        'doctorId',
        'procedureId',
        'priority',
      ]),
    );
    expect(storedConversation.operationDraft?.type).toBe('create_sc');
  });

  it('retoma draft existente do mesmo tipo (sem reiniciar)', async () => {
    await draftService.setFields('conv-1', 'create_sc', {
      patientId: 'pat-1',
    });

    const tool = getTool();
    const raw = await tool.execute(
      {
        intent: 'create_sc',
        mentioned_entities: { procedure: 'artroplastia' },
        plan_steps: ['perguntar prioridade'],
      },
      context,
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.data.draft_started).toBe(false);
    expect(storedConversation.operationDraft?.fields.patientId).toBe('pat-1');
  });

  it('NÃO abre draft para intent read_only', async () => {
    const tool = getTool();
    const raw = await tool.execute(
      {
        intent: 'read_only',
        mentioned_entities: {},
        plan_steps: ['listar SCs'],
      },
      context,
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.data.draft_type).toBeNull();
    expect(parsed?.data.draft_started).toBe(false);
    expect(storedConversation.operationDraft).toBeNull();
  });

  it('intent inválido vira "unknown" sem abrir draft', async () => {
    const tool = getTool();
    const raw = await tool.execute(
      {
        intent: 'foobar',
        plan_steps: [],
      },
      context,
    );
    const parsed = parseToolResult<any>(raw);
    expect(parsed?.data.intent).toBe('unknown');
    expect(parsed?.data.draft_type).toBeNull();
  });
});
