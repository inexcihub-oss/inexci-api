/**
 * webhook-whatsapp.e2e-spec.ts
 *
 * Suite e2e cobrindo os fluxos WhatsApp principais:
 *  - create_patient (draft commit via PatientsService)
 *  - create_hospital (draft commit via HospitalsService)
 *  - create_sc (draft commit via SurgeryRequestsService)
 *  - mark_performed (draft commit via SurgeryRequestWorkflowService)
 *  - invoice_request (draft commit via SurgeryRequestWorkflowService)
 *
 * Nível 1 — Contrato HTTP do webhook Twilio:
 *   Garante que o controller aceita mensagens de texto e enfileira no orchestrator.
 *
 * Nível 2 — Tool execution integrada (sem DB real):
 *   Exercita o OperationDraftService + tools de draft diretamente, verificando
 *   que os commits delegam aos Services corretos.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { WebhookController } from '../../src/modules/webhook/webhook.controller';
import { WebhookService } from '../../src/modules/webhook/webhook.service';
import { AiOrchestratorService } from '../../src/shared/ai/services/ai-orchestrator.service';
import { OperationDraftService } from '../../src/shared/ai/services/operation-draft.service';
import { buildCadastroDraftTools } from '../../src/shared/ai/tools/cadastro-draft.tools';
import { buildScDraftTools } from '../../src/shared/ai/tools/sc-draft.tools';
import { buildFlowDraftTransitionTools } from '../../src/shared/ai/tools/flow-draft-transition.tools';
import { buildFlowDraftTools } from '../../src/shared/ai/tools/flow-draft.tools';
import { ToolContext } from '../../src/shared/ai/tools/tool.interface';
import { parseToolResult } from '../../src/shared/ai/tools/tool-result';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConvRepo() {
  let conv: any = { id: 'conv-1', operationDraft: null };
  return {
    findOne: jest.fn().mockImplementation(async () => conv),
    update: jest.fn().mockImplementation(async (_id: any, patch: any) => {
      conv = { ...conv, ...patch };
    }),
  };
}

const BASE_CONTEXT: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
  ownerId: 'owner-1',
};

// ─── Nível 1: Contrato HTTP do webhook ───────────────────────────────────────

describe('Webhook WhatsApp — Contrato HTTP (e2e)', () => {
  let app: INestApplication;
  const enqueueInboundMessage = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        WebhookService,
        {
          provide: AiOrchestratorService,
          useValue: { enqueueInboundMessage },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: any) => {
              if (key === 'NODE_ENV') return 'test';
              if (key === 'TWILIO_VALIDATE_SIGNATURE') return 'false';
              return defaultValue;
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('aceita mensagem de texto simples e enfileira no orchestrator', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/twilio')
      .type('form')
      .send({
        From: 'whatsapp:+5511999990001',
        Body: 'quero criar um paciente',
        MessageSid: 'SM-WA-TEXT-1',
        NumMedia: '0',
      })
      .expect(200)
      .expect('<Response></Response>');

    expect(enqueueInboundMessage).toHaveBeenCalledTimes(1);
    const arg = enqueueInboundMessage.mock.calls[0][0];
    expect(arg.from).toBe('whatsapp:+5511999990001');
    expect(arg.body).toBe('quero criar um paciente');
    // Controller normaliza mensagens sem mídia como media=[]
    expect(arg.media).toEqual([]);
  });

  it('aceita mensagem de faturamento e enfileira corretamente', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/twilio')
      .type('form')
      .send({
        From: 'whatsapp:+5511999990002',
        Body: 'faturar a SC-0042',
        MessageSid: 'SM-WA-INVOICE-1',
        NumMedia: '0',
      })
      .expect(200);

    expect(enqueueInboundMessage).toHaveBeenCalledTimes(1);
    expect(enqueueInboundMessage.mock.calls[0][0].body).toBe(
      'faturar a SC-0042',
    );
  });

  it('responde 200 XML vazio para qualquer payload Twilio válido', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/twilio')
      .type('form')
      .send({
        From: 'whatsapp:+5511999990003',
        Body: 'marcar realizada',
        MessageSid: 'SM-WA-MARK-1',
        NumMedia: '0',
      })
      .expect(200)
      .expect('Content-Type', /xml|text/);
  });
});

// ─── Nível 2: Tool execution — create_patient ─────────────────────────────────

describe('WhatsApp tool execution — create_patient', () => {
  let draftService: OperationDraftService;
  let mockPatientsService: any;
  let tools: ReturnType<typeof buildCadastroDraftTools>;

  beforeEach(async () => {
    const convRepo = makeConvRepo();
    draftService = new OperationDraftService(convRepo as any);

    mockPatientsService = {
      create: jest.fn().mockResolvedValue({
        id: 'pat-wa-1',
        name: 'Maria Souza',
        phone: '11988880000',
        email: 'maria@example.com',
      }),
    };

    tools = buildCadastroDraftTools({
      draftService,
      patientRepo: { findMany: jest.fn().mockResolvedValue([]) } as any,
      procedureRepo: { findOne: jest.fn(), findMany: jest.fn() } as any,
      userRepo: {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' }),
      } as any,
      patientsService: mockPatientsService,
      hospitalsService: { create: jest.fn() } as any,
      healthPlansService: { create: jest.fn() } as any,
      proceduresService: { create: jest.fn() } as any,
    });
  });

  it('fluxo completo: setFields (via draft_update) → preview → commit', async () => {
    await draftService.start({
      conversationId: 'conv-1',
      type: 'create_patient',
    });
    // Setters per-type (`patient_draft_set_*`) foram removidos na Fase 5 do
    // PLANO-SANITIZACAO-CLEAN-CODE-IA. O LLM agora usa `draft_update`; aqui
    // chamamos `setFields` direto no service para focar no preview/commit.
    await draftService.setFields('conv-1', 'create_patient', {
      name: 'Maria Souza',
      phone: '11988880000',
      doctorId: 'doctor-1',
      doctorLabel: 'Dra. Maria',
    });

    const getTool = (name: string) => tools.find((t) => t.name === name)!;

    const preview = await getTool('patient_draft_preview').execute(
      {},
      BASE_CONTEXT,
    );
    expect(parseToolResult(preview)?.status).toBe('pending_confirmation');

    const commit = await getTool('patient_draft_commit').execute(
      { confirm: true },
      BASE_CONTEXT,
    );
    const result = parseToolResult(commit);
    expect(result).not.toBeNull();
    if (!result) throw new Error('Tool result inválido');
    expect(result.status).toBe('ok');
    expect(mockPatientsService.create).toHaveBeenCalledTimes(1);
    expect(mockPatientsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Maria Souza', phone: '11988880000' }),
      'user-1',
    );
  });
});

// ─── Nível 2: Tool execution — create_hospital ────────────────────────────────

describe('WhatsApp tool execution — create_hospital', () => {
  let draftService: OperationDraftService;
  let mockHospitalsService: any;
  let tools: ReturnType<typeof buildCadastroDraftTools>;

  beforeEach(async () => {
    const convRepo = makeConvRepo();
    draftService = new OperationDraftService(convRepo as any);

    mockHospitalsService = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'hosp-wa-1', name: 'Hospital Beneficência' }),
    };

    tools = buildCadastroDraftTools({
      draftService,
      patientRepo: { findMany: jest.fn().mockResolvedValue([]) } as any,
      procedureRepo: { findOne: jest.fn(), findMany: jest.fn() } as any,
      userRepo: {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' }),
      } as any,
      patientsService: { create: jest.fn() } as any,
      hospitalsService: mockHospitalsService,
      healthPlansService: { create: jest.fn() } as any,
      proceduresService: { create: jest.fn() } as any,
    });
  });

  it('fluxo completo: setFields (via draft_update) → commit via HospitalsService', async () => {
    await draftService.start({
      conversationId: 'conv-1',
      type: 'create_hospital',
    });
    await draftService.setFields('conv-1', 'create_hospital', {
      name: 'Hospital Beneficência',
    });

    const getTool = (name: string) => tools.find((t) => t.name === name)!;

    const commit = await getTool('hospital_draft_commit').execute(
      { confirm: true },
      BASE_CONTEXT,
    );
    expect(parseToolResult(commit)?.status).toBe('ok');
    expect(mockHospitalsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hospital Beneficência' }),
      'user-1',
    );
  });
});

// ─── Nível 2: Tool execution — create_sc ──────────────────────────────────────

describe('WhatsApp tool execution — create_sc', () => {
  let draftService: OperationDraftService;
  let mockSurgeryRequestsService: any;
  let tools: ReturnType<typeof buildScDraftTools>;

  beforeEach(async () => {
    const convRepo = makeConvRepo();
    draftService = new OperationDraftService(convRepo as any);

    mockSurgeryRequestsService = {
      createSurgeryRequest: jest.fn().mockResolvedValue({
        id: 'sc-wa-1',
        protocol: 'SC-0099',
      }),
    };

    tools = buildScDraftTools({
      draftService,
      userRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'user-1',
          ownerId: 'owner-1',
          name: 'Dr. Alberto',
        }),
      } as any,
      surgeryRequestRepo: {
        create: jest.fn(),
        findOneSimple: jest
          .fn()
          .mockResolvedValue({ id: 'sc-wa-1', protocol: 'SC-0099' }),
        findOne: jest.fn(),
      } as any,
      surgeryRequestsService: mockSurgeryRequestsService as any,
      activityRepo: { create: jest.fn().mockResolvedValue({}) } as any,
      opmeService: { create: jest.fn() } as any,
      tussService: { lookup: jest.fn().mockReturnValue([]) } as any,
    });
  });

  it('fluxo completo: preenchimento manual + commit via SurgeryRequestsService', async () => {
    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });
    await draftService.setFields('conv-1', 'create_sc', {
      patientId: 'pat-1',
      patientLabel: 'João',
      doctorId: 'doctor-1',
      doctorLabel: 'Dr. Alberto',
      procedureId: 'proc-1',
      procedureLabel: 'Artroplastia',
      priority: 'HIGH',
    });

    const ctx = { ...BASE_CONTEXT, accessibleDoctorIds: ['doctor-1'] };
    const commit = tools.find((t) => t.name === 'sc_draft_commit')!;
    const result = await commit.execute({ confirm: true }, ctx);
    const parsed = parseToolResult(result);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Tool result inválido');

    expect(parsed.status).toBe('ok');
    expect(
      mockSurgeryRequestsService.createSurgeryRequest,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'pat-1',
        doctorId: 'doctor-1',
        procedureId: 'proc-1',
      }),
      'user-1',
    );
  });
});

// ─── Nível 2: Tool execution — mark_performed ─────────────────────────────────

describe('WhatsApp tool execution — mark_performed', () => {
  let draftService: OperationDraftService;
  let mockWorkflowService: any;
  let tools: ReturnType<typeof buildFlowDraftTransitionTools>;

  beforeEach(async () => {
    const convRepo = makeConvRepo();
    draftService = new OperationDraftService(convRepo as any);

    mockWorkflowService = {
      markPerformed: jest.fn().mockResolvedValue({ id: 'sc-1', status: 6 }),
    };

    tools = buildFlowDraftTransitionTools({
      draftService,
      surgeryRequestRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'sc-1',
          protocol: 'SC-0042',
          status: 5,
          ownerId: 'owner-1',
        }),
        findOneSimple: jest
          .fn()
          .mockResolvedValue({ id: 'sc-1', protocol: 'SC-0042', status: 5 }),
      } as any,
      workflowService: mockWorkflowService as any,
      activityRepo: { create: jest.fn().mockResolvedValue({}) } as any,
      documentRepo: {
        // checkPostSurgeryDocuments usa `d.key` para verificar documentos presentes
        findMany: jest.fn().mockResolvedValue([
          { key: 'surgery_room', surgeryRequestId: 'sc-1' },
          { key: 'surgery_auth_document', surgeryRequestId: 'sc-1' },
        ]),
      } as any,
      pendencyValidator: { getSummary: jest.fn().mockResolvedValue([]) } as any,
    });
  });

  it('fluxo mark_performed: start → set_request → set_performed_at → commit', async () => {
    await draftService.start({
      conversationId: 'conv-1',
      type: 'mark_performed',
    });
    await draftService.setFields('conv-1', 'mark_performed', {
      surgeryRequestId: 'sc-1',
      surgeryRequestLabel: 'SC-0042',
      surgeryPerformedAt: '2026-05-10',
    });

    const commit = tools.find((t) => t.name === 'mark_performed_draft_commit')!;
    const result = await commit.execute({ confirm: true }, BASE_CONTEXT);
    const parsed = parseToolResult(result);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Tool result inválido');

    expect(parsed.status).toBe('ok');
    expect(mockWorkflowService.markPerformed).toHaveBeenCalledTimes(1);
    expect(mockWorkflowService.markPerformed).toHaveBeenCalledWith(
      'sc-1',
      expect.objectContaining({ surgeryPerformedAt: '2026-05-10' }),
      'user-1',
    );
  });
});

// ─── Nível 2: Tool execution — invoice_request ────────────────────────────────

describe('WhatsApp tool execution — invoice_request (draft)', () => {
  let draftService: OperationDraftService;
  let mockWorkflowService: any;
  let tools: ReturnType<typeof buildFlowDraftTools>;

  beforeEach(async () => {
    const convRepo = makeConvRepo();
    draftService = new OperationDraftService(convRepo as any);

    mockWorkflowService = {
      invoiceRequest: jest.fn().mockResolvedValue({ id: 'sc-1', status: 7 }),
    };

    tools = buildFlowDraftTools({
      draftService,
      surgeryRequestRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'sc-1',
          protocol: 'SC-0042',
          status: 6,
          ownerId: 'owner-1',
        }),
      } as any,
      workflowService: mockWorkflowService as any,
      activityRepo: { create: jest.fn().mockResolvedValue({}) } as any,
      patientsService: { create: jest.fn() } as any,
      surgeryRequestsService: { createSurgeryRequest: jest.fn() } as any,
    });
  });

  it('fluxo invoice: preenchimento + commit via workflowService.invoiceRequest', async () => {
    await draftService.start({ conversationId: 'conv-1', type: 'invoice' });
    await draftService.setFields('conv-1', 'invoice', {
      surgeryRequestId: 'sc-1',
      surgeryRequestLabel: 'SC-0042',
      invoiceProtocol: 'FAT-2026-001',
      invoiceValue: 4500.0,
      invoiceSentAt: '2026-05-12',
    });

    const commit = tools.find((t) => t.name === 'invoice_draft_commit')!;
    const result = await commit.execute({ confirm: true }, BASE_CONTEXT);
    const parsed = parseToolResult(result);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Tool result inválido');

    expect(parsed.status).toBe('ok');
    expect(mockWorkflowService.invoiceRequest).toHaveBeenCalledTimes(1);
    expect(mockWorkflowService.invoiceRequest).toHaveBeenCalledWith(
      'sc-1',
      expect.objectContaining({
        invoiceProtocol: 'FAT-2026-001',
        invoiceValue: 4500,
      }),
      'user-1',
    );
  });
});

// ─── Nível 2: Tool execution — draft_update (Fase 5) ─────────────────────────

describe('WhatsApp tool execution — draft_update (generic, Fase 5)', () => {
  it('draft_update atualiza campo e retorna status correto', async () => {
    const { buildDraftGenericTools } =
      await import('../../src/shared/ai/tools/draft-generic.tools');
    const convRepo = makeConvRepo();
    const draftService = new OperationDraftService(convRepo as any);
    const tools = buildDraftGenericTools({ draftService });
    const draftUpdate = tools.find((t) => t.name === 'draft_update')!;

    await draftService.start({ conversationId: 'conv-1', type: 'invoice' });

    const result = await draftUpdate.execute(
      {
        draft_type: 'invoice',
        field: 'invoiceProtocol',
        value: 'FAT-2026-099',
      },
      BASE_CONTEXT,
    );
    const parsed = parseToolResult(result);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Tool result inválido');
    expect(parsed.status).not.toBe('error');

    const draft = await draftService.getCurrentOfType('conv-1', 'invoice');
    expect(draft?.fields.invoiceProtocol).toBe('FAT-2026-099');
  });

  it('draft_update rejeita campo inválido para o draft_type', async () => {
    const { buildDraftGenericTools } =
      await import('../../src/shared/ai/tools/draft-generic.tools');
    const convRepo = makeConvRepo();
    const draftService = new OperationDraftService(convRepo as any);
    const tools = buildDraftGenericTools({ draftService });
    const draftUpdate = tools.find((t) => t.name === 'draft_update')!;

    await draftService.start({
      conversationId: 'conv-1',
      type: 'create_hospital',
    });

    const result = await draftUpdate.execute(
      { draft_type: 'create_hospital', field: 'campoInexistente', value: 'x' },
      BASE_CONTEXT,
    );
    const parsed = parseToolResult(result);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Tool result inválido');
    expect(parsed.status).toBe('error');
    expect(parsed.message ?? '').toContain('campoInexistente');
  });

  it('draft_status retorna draft ativo com campos preenchidos', async () => {
    const { buildDraftGenericTools } =
      await import('../../src/shared/ai/tools/draft-generic.tools');
    const convRepo = makeConvRepo();
    const draftService = new OperationDraftService(convRepo as any);
    const tools = buildDraftGenericTools({ draftService });
    const draftStatus = tools.find((t) => t.name === 'draft_status')!;

    await draftService.start({
      conversationId: 'conv-1',
      type: 'create_patient',
    });
    await draftService.setFields('conv-1', 'create_patient', {
      name: 'Carlos Lima',
    });

    const result = await draftStatus.execute({}, BASE_CONTEXT);
    const parsed = parseToolResult(result);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Tool result inválido');
    expect(parsed.status).not.toBe('error');
    expect(JSON.stringify(parsed.data ?? '')).toContain('create_patient');
  });

  it('draft_cancel descarta o rascunho ativo', async () => {
    const { buildDraftGenericTools } =
      await import('../../src/shared/ai/tools/draft-generic.tools');
    const convRepo = makeConvRepo();
    const draftService = new OperationDraftService(convRepo as any);
    const tools = buildDraftGenericTools({ draftService });
    const draftCancel = tools.find((t) => t.name === 'draft_cancel')!;

    await draftService.start({ conversationId: 'conv-1', type: 'create_sc' });

    const result = await draftCancel.execute({}, BASE_CONTEXT);
    expect(parseToolResult(result)?.status).toBe('ok');

    const draft = await draftService.getCurrent('conv-1');
    expect(draft).toBeNull();
  });
});
