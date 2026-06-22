import { DocumentIntakeService } from './orchestrator/document-intake.service';
import { PhoneNormalizerService } from './orchestrator/phone-normalizer.service';

/**
 * Cobertura do `buildDocumentPendingHint`: o hint determinístico que
 * injetamos no system prompt quando há um documento pendente já
 * classificado pelo pipeline OCR + LLM. Sem esse hint o LLM "esquecia" o
 * documento entre turnos e respondia "não ficou claro qual ação você
 * quer confirmar" em loop, mesmo após o usuário dizer "sim".
 *
 * Migrado de `ai-orchestrator.document-pending-hint.spec.ts` para testar
 * diretamente `DocumentIntakeService` após a extração na Fase 5 do
 * PLANO-CORRECOES-CODE-REVIEW-2026-05-13.
 */
describe('DocumentIntakeService — buildDocumentPendingHint', () => {
  let service: DocumentIntakeService;
  const documentDispatcherMock = {
    isEnabled: jest.fn().mockReturnValue(false),
    pickDocumentMedia: jest.fn().mockReturnValue(null),
    stageInboundDocument: jest
      .fn()
      .mockResolvedValue({ status: 'no_document' }),
    getPending: jest.fn().mockResolvedValue(null),
    savePending: jest.fn().mockResolvedValue(undefined),
    clearPending: jest.fn().mockResolvedValue(undefined),
    deleteStoragePath: jest.fn().mockResolvedValue(undefined),
    parseIntent: jest.fn().mockReturnValue(null),
    buildDownloadFailureMessage: jest.fn().mockReturnValue('falha'),
    buildIntentPromptMessage: jest.fn().mockReturnValue('intent'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DocumentIntakeService(
      documentDispatcherMock as any,
      {
        processPendingDocument: jest
          .fn()
          .mockResolvedValue({ status: 'ok', userSummary: 'resumo' }),
      } as any,
      { sendMessage: jest.fn(), sendTemplate: jest.fn() } as any,
      {
        appendMessage: jest.fn(),
        getOrCreateConversation: jest.fn(),
        resetConversationHistory: jest.fn(),
      } as any,
      new PhoneNormalizerService({ findOneByPhone: jest.fn() } as any),
      {
        getAwaitingMedia: jest.fn().mockResolvedValue(null),
        setAwaitingMedia: jest.fn().mockResolvedValue(undefined),
        clearAwaitingMedia: jest.fn().mockResolvedValue(undefined),
      } as any,
    );
  });

  function buildPending(overrides: Record<string, any> = {}) {
    return {
      storagePath: 'whatsapp-tmp/abc.pdf',
      contentType: 'application/pdf',
      sizeBytes: 12345,
      fileName: 'laudo.pdf',
      kind: 'pdf' as const,
      receivedAt: Date.now() - 60_000,
      expiresAt: Date.now() + 600_000,
      messageSid: 'SM-test',
      classifiedAt: Date.now() - 30_000,
      ...overrides,
    };
  }

  it('retorna null quando não há pending', async () => {
    documentDispatcherMock.getPending.mockResolvedValueOnce(null);
    const hint = await service.buildDocumentPendingHint('+5511999999999');
    expect(hint).toBeNull();
  });

  it('retorna null quando pending existe mas não foi classificado', async () => {
    documentDispatcherMock.getPending.mockResolvedValueOnce(
      buildPending({ classification: null, classifiedAt: null, intent: null }),
    );
    const hint = await service.buildDocumentPendingHint('+5511999999999');
    expect(hint).toBeNull();
  });

  it('retorna null quando classificação é antiga (> 5 min)', async () => {
    documentDispatcherMock.getPending.mockResolvedValueOnce(
      buildPending({
        classifiedAt: Date.now() - 6 * 60 * 1000,
        intent: 'create_sc',
        classification: {
          kind: 'medical_report',
          confidence: 0.9,
          suggestedDocumentType: 'medical_report',
          extracted: {},
        },
      }),
    );
    const hint = await service.buildDocumentPendingHint('+5511999999999');
    expect(hint).toBeNull();
  });

  it('intent=create_sc: instrui o LLM a chamar sc_draft_* com os dados extraídos', async () => {
    documentDispatcherMock.getPending.mockResolvedValueOnce(
      buildPending({
        intent: 'create_sc',
        classification: {
          kind: 'medical_report',
          confidence: 0.85,
          suggestedDocumentType: 'medical_report',
          extracted: {
            patient: {
              name: 'Joao da Silva',
              cpf: '{{cpf_1}}',
              birthDate: '1980-01-01',
            },
            hospital: 'Hospital Albert Einstein',
            tuss: [{ code: '12345', description: 'Artroscopia' }],
          },
        },
      }),
    );
    const hint = await service.buildDocumentPendingHint('+5511999999999');
    expect(hint).toContain('CONTEXTO DETERMINÍSTICO — DOCUMENTO PENDENTE');
    expect(hint).toContain('medical_report');
    expect(hint).toContain('Paciente: Joao da Silva');
    expect(hint).toContain('CPF: {{cpf_1}}');
    expect(hint).toContain('Hospital: Hospital Albert Einstein');
    expect(hint).toContain('TUSS: 12345 (Artroscopia)');
    expect(hint).toContain('draft_update');
    expect(hint).toContain('sc_draft_commit');
    expect(hint).toContain(
      'NUNCA responda "não ficou claro qual ação você quer confirmar"',
    );
  });

  it('intent=attach: instrui o LLM a chamar attach_document_from_whatsapp', async () => {
    documentDispatcherMock.getPending.mockResolvedValueOnce(
      buildPending({
        intent: 'attach',
        classification: {
          kind: 'authorization_guide',
          confidence: 0.92,
          suggestedDocumentType: 'authorization_guide',
          extracted: { hospital: 'Hospital São Lucas' },
        },
      }),
    );
    const hint = await service.buildDocumentPendingHint('+5511999999999');
    expect(hint).toContain('attach_document_from_whatsapp');
    expect(hint).toContain('query_surgery_requests');
  });

  it('intent=create_patient: instrui o LLM a chamar create_patient_from_document', async () => {
    documentDispatcherMock.getPending.mockResolvedValueOnce(
      buildPending({
        intent: 'create_patient',
        classification: {
          kind: 'personal_document',
          confidence: 0.88,
          suggestedDocumentType: 'personal_document',
          extracted: {
            patient: { name: 'Maria Santos', cpf: '{{cpf_2}}' },
          },
        },
      }),
    );
    const hint = await service.buildDocumentPendingHint('+5511999999999');
    expect(hint).toContain('create_patient_from_document');
    expect(hint).toContain('Maria Santos');
  });

  it('quando há ambiguity, adiciona alerta', async () => {
    documentDispatcherMock.getPending.mockResolvedValueOnce(
      buildPending({
        intent: 'create_sc',
        classification: {
          kind: 'medical_report',
          confidence: 0.65,
          suggestedDocumentType: 'medical_report',
          extracted: {},
          ambiguity: 'Pode ser laudo ou guia de autorização',
        },
      }),
    );
    const hint = await service.buildDocumentPendingHint('+5511999999999');
    expect(hint).toContain('ATENÇÃO: o classificador marcou ambiguidade');
    expect(hint).toContain('Pode ser laudo ou guia de autorização');
  });

  it('intent=create_sc COM dados RICOS ativa MODO AUTO-CRIAR', async () => {
    documentDispatcherMock.getPending.mockResolvedValueOnce(
      buildPending({
        intent: 'create_sc',
        classification: {
          kind: 'surgery_request',
          confidence: 0.95,
          suggestedDocumentType: 'medical_report',
          extracted: {
            patient: { name: 'Jean Pierre Pereira Proximo' },
            healthPlan: { name: 'Bradesco' },
            diagnosis: 'Hérnia discal cervical médio-foraminal C5-C6 e C4-C5',
            suggestedProcedureName: 'Artrodese cervical anterior C5-C6 e C4-C5',
            tuss: [
              { code: '3.07.15.091', description: 'Descompressão medular' },
              {
                code: '3.07.15.024',
                description: 'Artrodese de coluna via anterior',
              },
            ],
            opme: [
              {
                description: 'CAGES STAND ALONE',
                qty: 2,
                supplier: 'SINTEX',
                manufacturer: 'DIVA/NOVA SPINE',
              },
            ],
            suggestedSuppliers: ['SINTEX', 'VITALITY', 'GUSMED'],
            laudoText:
              'Paciente com queixa de dor radicular braquial à esquerda. Indicado procedimento cirúrgico com artrodese cervical.',
          },
        },
      }),
    );

    const hint = await service.buildDocumentPendingHint('+5511999999999');

    expect(hint).toContain('MODO AUTO-CRIAR ATIVADO');
    expect(hint).toContain('Diagnóstico: Hérnia discal cervical');
    expect(hint).toContain(
      'Procedimento sugerido: Artrodese cervical anterior C5-C6 e C4-C5',
    );
    expect(hint).toContain('CAGES STAND ALONE');
    expect(hint).toContain('SINTEX');
    expect(hint).toContain('Fornecedores sugeridos: SINTEX, VITALITY, GUSMED');
    expect(hint).toContain('Laudo (texto completo');
    expect(hint).toContain('draft_update({ draft_type: "create_sc"');
    expect(hint).toContain('"procedureId"');
    expect(hint).toContain('"notes"');
    expect(hint).not.toContain('draft_update({ fields:');
    // A tool correta é `query_patients` (a antiga `find_patient_by_name` não
    // existe — referenciá-la fazia o LLM tentar uma tool inexistente, que
    // virava "Estou enfrentando um problema técnico para buscar o paciente").
    expect(hint).toContain('query_patients');
    expect(hint).not.toContain('find_patient_by_name');
    expect(hint).toContain('NUNCA fragmente');
    expect(hint).not.toContain('CRM');
  });

  it('intent=create_sc com dados POBRES NÃO ativa modo auto-criar', async () => {
    documentDispatcherMock.getPending.mockResolvedValueOnce(
      buildPending({
        intent: 'create_sc',
        classification: {
          kind: 'medical_report',
          confidence: 0.85,
          suggestedDocumentType: 'medical_report',
          extracted: {
            patient: { name: 'Maria Costa' },
          },
        },
      }),
    );

    const hint = await service.buildDocumentPendingHint('+5511999999999');

    expect(hint).not.toContain('MODO AUTO-CRIAR');
    expect(hint).toContain('draft_update');
    expect(hint).toContain('patient_name');
  });

  it('retorna null silenciosamente quando getPending lança', async () => {
    documentDispatcherMock.getPending.mockRejectedValueOnce(
      new Error('redis down'),
    );
    const hint = await service.buildDocumentPendingHint('+5511999999999');
    expect(hint).toBeNull();
  });
});
