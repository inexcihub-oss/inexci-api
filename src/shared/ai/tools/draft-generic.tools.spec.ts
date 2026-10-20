import { buildDraftGenericTools } from './draft-generic.tools';
import { OperationDraftService } from '../services/operation-draft.service';
import { PiiVaultService } from '../services/pii-vault.service';
import { parseToolResult } from './tool-result';
import { ToolContext } from './tool.interface';

function makeConvRepo() {
  let conv: Record<string, unknown> = { id: 'conv-1', operationDraft: null };
  return {
    findOne: jest.fn(async () => conv),
    update: jest.fn(async (_id: unknown, patch: Record<string, unknown>) => {
      conv = { ...conv, ...patch };
    }),
  };
}

describe('draft genéricos — PII ecoada volta tokenizada', () => {
  let draftService: OperationDraftService;
  let piiVault: PiiVaultService;
  let context: ToolContext;
  let tools: ReturnType<typeof buildDraftGenericTools>;
  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(async () => {
    draftService = new OperationDraftService(makeConvRepo() as any);
    piiVault = new PiiVaultService();
    piiVault.startSession('conv-1');
    context = {
      userId: 'user-1',
      phone: '+5511999999999',
      accessibleDoctorIds: ['doctor-1'],
      conversationId: 'conv-1',
      piiVault,
    };
    tools = buildDraftGenericTools({
      draftService,
      surgeryRequestRepo: { findOneSimple: jest.fn() } as any,
    });
    await draftService.start({
      conversationId: 'conv-1',
      type: 'create_patient',
    });
  });

  it('draft_update devolve o CPF como token e grava o valor real no rascunho', async () => {
    const parsed = parseToolResult<{ field: string; value: string }>(
      await getTool('draft_update').execute(
        { draft_type: 'create_patient', field: 'cpf', value: '52998224725' },
        context,
      ),
    );

    expect(parsed?.data?.value).toMatch(/^\{\{cpf_\d+\}\}$/);
    const draft = await draftService.getCurrent('conv-1');
    expect(draft?.fields).toEqual(
      expect.objectContaining({ cpf: '52998224725' }),
    );
  });

  it('draft_update mantém em claro campo sem PII sensível (nome)', async () => {
    const parsed = parseToolResult<{ value: string }>(
      await getTool('draft_update').execute(
        { draft_type: 'create_patient', field: 'name', value: 'Maria Silva' },
        context,
      ),
    );

    expect(parsed?.data?.value).toBe('Maria Silva');
  });

  it('draft_status devolve os campos PII do rascunho tokenizados', async () => {
    await getTool('draft_update').execute(
      { draft_type: 'create_patient', field: 'email', value: 'maria@x.com' },
      context,
    );

    const raw = await getTool('draft_status').execute({}, context);

    expect(raw).not.toContain('maria@x.com');
    const parsed = parseToolResult<{ fields: Record<string, string> }>(raw);
    expect(parsed?.data?.fields.email).toMatch(/^\{\{email_\d+\}\}$/);
  });
});
