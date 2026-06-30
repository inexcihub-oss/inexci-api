import { WhatsappDocumentProcessorService } from './whatsapp-document-processor.service';
import { PendingDocumentRequest } from './whatsapp-document-dispatcher.service';

describe('WhatsappDocumentProcessorService', () => {
  const buildPending = (
    overrides: Partial<PendingDocumentRequest> = {},
  ): PendingDocumentRequest => ({
    storagePath: 'whatsapp-tmp/abc.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    fileName: 'laudo.pdf',
    kind: 'pdf',
    receivedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    messageSid: 'SM-1',
    ...overrides,
  });

  const buildClassification = (overrides: Record<string, unknown> = {}) => ({
    kind: 'medical_report',
    confidence: 0.88,
    suggestedDocumentType: 'medical_report',
    extracted: {
      patient: { name: 'Joao da Silva', cpf: '{{cpf_1}}' },
    },
    durationMs: 50,
    model: 'gpt-4o-mini',
    ...overrides,
  });

  let storage: any;
  let extractor: any;
  let dispatcher: any;
  let aiTokenUsageLogRepo: any;
  let service: WhatsappDocumentProcessorService;

  beforeEach(() => {
    storage = {
      download: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    };
    extractor = {
      extractFromBuffer: jest.fn().mockResolvedValue({
        status: 'ok',
        classification: buildClassification(),
        usedVisionFallback: false,
        usageSnapshots: [
          {
            stage: 'doc_classifier',
            promptTokens: 320,
            completionTokens: 110,
            totalTokens: 430,
            model: 'gpt-4o-mini',
            latencyMs: 50,
          },
        ],
        ocrTokenizedText:
          'paciente Joao da Silva, CPF {{cpf_1}}, telefone {{phone_1}} e mais texto',
      }),
      isExtractedEffectivelyEmpty: jest.fn().mockReturnValue(false),
    };
    dispatcher = {
      savePending: jest.fn().mockResolvedValue(undefined),
      clearPending: jest.fn().mockResolvedValue(undefined),
    };
    aiTokenUsageLogRepo = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    service = new WhatsappDocumentProcessorService(
      storage,
      extractor,
      dispatcher,
      aiTokenUsageLogRepo,
    );
  });

  it('chama o extractor com os dados corretos e atualiza pending', async () => {
    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending(),
      intent: 'attach',
      conversationId: 'conv-1',
      messageSid: 'SM-1',
      userId: 'user-1',
      ownerId: 'owner-1',
    });

    expect(storage.download).toHaveBeenCalledWith('whatsapp-tmp/abc.pdf');
    expect(extractor.extractFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'application/pdf',
        filename: 'laudo.pdf',
        sessionId: 'SM-1',
        intent: 'attach',
      }),
    );

    expect(dispatcher.savePending).toHaveBeenCalledWith(
      '+5511988887777',
      expect.objectContaining({
        intent: 'attach',
        classification: expect.objectContaining({ kind: 'medical_report' }),
        ocrTokenizedText: expect.stringContaining('{{cpf_1}}'),
      }),
    );

    expect(aiTokenUsageLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messageSid: 'SM-1',
        userId: 'user-1',
        ownerId: 'owner-1',
        promptTokens: 320,
        completionTokens: 110,
        totalTokens: 430,
        callsCount: 1,
        model: 'gpt-4o-mini',
        breakdown: expect.arrayContaining([
          expect.objectContaining({ stage: 'doc_classifier' }),
        ]),
      }),
    );

    expect(result.status).toBe('ok');
    expect(result.usedVisionFallback).toBe(false);
    expect(result.userSummary).toContain('Laudo médico');
    expect(result.userSummary).toContain('Joao da Silva');
    expect(result.userSummary).toContain('protocolo');
  });

  it('limpa pending e devolve erro amigável quando o arquivo sumiu do storage', async () => {
    storage.download.mockResolvedValueOnce(null);

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending(),
      intent: 'create_patient',
      conversationId: 'conv-1',
      messageSid: 'SM-2',
    });

    expect(result.status).toBe('storage_missing');
    expect(result.errorMessage).toContain('reenvie');
    expect(dispatcher.clearPending).toHaveBeenCalledWith('+5511988887777');
    expect(extractor.extractFromBuffer).not.toHaveBeenCalled();
    expect(aiTokenUsageLogRepo.create).not.toHaveBeenCalled();
  });

  it('devolve ocr_empty quando extractor retorna status ocr_empty', async () => {
    extractor.extractFromBuffer.mockResolvedValueOnce({
      status: 'ocr_empty',
      classification: null,
      usedVisionFallback: false,
      usageSnapshots: [],
      ocrTokenizedText: '',
      errorReason: 'texto insuficiente',
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending(),
      intent: 'attach',
      conversationId: 'conv-1',
      messageSid: 'SM-3',
    });

    expect(result.status).toBe('ocr_empty');
    expect(result.errorMessage).toContain('nítida');
    expect(dispatcher.savePending).not.toHaveBeenCalled();
  });

  it('devolve classifier_failed quando extractor retorna status classifier_failed', async () => {
    extractor.extractFromBuffer.mockResolvedValueOnce({
      status: 'classifier_failed',
      classification: null,
      usedVisionFallback: false,
      usageSnapshots: [],
      ocrTokenizedText: '',
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending({ contentType: 'image/png', kind: 'image' }),
      intent: 'create_sc',
      conversationId: 'conv-1',
      messageSid: 'SM-4',
    });

    expect(result.status).toBe('classifier_failed');
    expect(result.errorMessage).toContain('classificá-lo');
    expect(dispatcher.savePending).not.toHaveBeenCalled();
  });

  it('propagates vision fallback flag from extractor', async () => {
    extractor.extractFromBuffer.mockResolvedValueOnce({
      status: 'ok',
      classification: buildClassification({ kind: 'identity_document' }),
      usedVisionFallback: true,
      usageSnapshots: [
        {
          stage: 'doc_vision_fallback',
          promptTokens: 800,
          completionTokens: 120,
          totalTokens: 920,
          model: 'gpt-4o',
          latencyMs: 1500,
        },
      ],
      ocrTokenizedText: '',
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending({ contentType: 'image/jpeg', kind: 'image' }),
      intent: 'create_patient',
      conversationId: 'conv-1',
      messageSid: 'SM-FB-1',
    });

    expect(result.status).toBe('ok');
    expect(result.usedVisionFallback).toBe(true);
    expect(aiTokenUsageLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        callsCount: 1,
        model: 'gpt-4o',
        breakdown: expect.arrayContaining([
          expect.objectContaining({ stage: 'doc_vision_fallback' }),
        ]),
      }),
    );
  });

  it('userSummary é honesto quando extracted vazio: pede dados em vez de prometer SC', async () => {
    extractor.isExtractedEffectivelyEmpty.mockReturnValue(true);
    extractor.extractFromBuffer.mockResolvedValueOnce({
      status: 'ok',
      classification: buildClassification({ extracted: {} }),
      usedVisionFallback: false,
      usageSnapshots: [
        {
          stage: 'doc_classifier',
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          model: 'gpt-4o-mini',
          latencyMs: 40,
        },
      ],
      ocrTokenizedText: '',
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending({ contentType: 'image/png', kind: 'image' }),
      intent: 'create_sc',
      conversationId: 'conv-1',
      messageSid: 'SM-EMPTY',
    });

    expect(result.userSummary).toContain('Não consegui extrair dados úteis');
    expect(result.userSummary).not.toContain('Posso seguir?');
  });

  it('preview com dados ricos informa "Já vou montar"', async () => {
    extractor.extractFromBuffer.mockResolvedValueOnce({
      status: 'ok',
      classification: buildClassification({
        kind: 'surgery_request',
        extracted: {
          patient: { name: 'Jean Pierre' },
          healthPlan: { name: 'Bradesco' },
          suggestedProcedureName: 'Artrodese C5-C6',
          tuss: [{ code: '3.07.15.091', description: 'Descompressão' }],
          laudoText: 'Laudo detalhado aqui.',
        },
      }),
      usedVisionFallback: false,
      usageSnapshots: [
        {
          stage: 'doc_classifier',
          promptTokens: 800,
          completionTokens: 400,
          totalTokens: 1200,
          model: 'gpt-4o-mini',
          latencyMs: 60,
        },
      ],
      ocrTokenizedText: 'Jean Pierre laudo...',
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending(),
      intent: 'create_sc',
      conversationId: 'conv-rich',
      messageSid: 'SM-RICH',
    });

    expect(result.status).toBe('ok');
    expect(result.userSummary).toContain('Já vou montar a solicitação cirúrgica');
    expect(result.userSummary).not.toContain('Posso seguir?');
  });
});
