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

  let storage: any;
  let ocr: any;
  let classifier: any;
  let dispatcher: any;
  let visionFallback: any;
  let aiTokenUsageLogRepo: any;
  let service: WhatsappDocumentProcessorService;

  beforeEach(() => {
    storage = {
      download: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    };
    ocr = {
      extractAndTokenize: jest.fn().mockResolvedValue({
        text: 'paciente Joao da Silva, CPF 52998224725 e mais texto longo aqui',
        tokenizedText:
          'paciente Joao da Silva, CPF {{cpf_1}}, telefone {{phone_1}} e mais texto',
        confidence: 0.91,
        pageCount: 1,
        pagesProcessed: 1,
        truncatedPages: 0,
        source: 'pdf-native',
        pages: [],
        durationMs: 12,
        warnings: [],
      }),
    };
    classifier = {
      classifyWithUsage: jest.fn().mockResolvedValue({
        classification: {
          kind: 'medical_report',
          confidence: 0.88,
          suggestedDocumentType: 'medical_report',
          extracted: {
            patient: { name: 'Joao da Silva', cpf: '{{cpf_1}}' },
          },
          durationMs: 50,
          model: 'gpt-4o-mini',
        },
        usage: {
          promptTokens: 320,
          completionTokens: 110,
          totalTokens: 430,
          model: 'gpt-4o-mini',
          latencyMs: 50,
        },
      }),
    };
    dispatcher = {
      savePending: jest.fn().mockResolvedValue(undefined),
      clearPending: jest.fn().mockResolvedValue(undefined),
    };
    visionFallback = {
      isEnabled: jest.fn().mockReturnValue(true),
      isSupportedImageMime: jest.fn((mime: string) =>
        ['image/jpeg', 'image/png', 'image/webp'].includes(mime),
      ),
      classifyImage: jest.fn(),
    };
    aiTokenUsageLogRepo = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    service = new WhatsappDocumentProcessorService(
      storage,
      ocr,
      classifier,
      dispatcher,
      visionFallback,
      aiTokenUsageLogRepo,
    );
  });

  it('roda OCR + classifier, atualiza pending, persiste token usage e devolve resumo', async () => {
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
    expect(ocr.extractAndTokenize).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'application/pdf',
        filename: 'laudo.pdf',
      }),
      'conv-1',
    );
    expect(classifier.classifyWithUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('{{cpf_1}}'),
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

    expect(visionFallback.classifyImage).not.toHaveBeenCalled();
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
    expect(ocr.extractAndTokenize).not.toHaveBeenCalled();
    expect(classifier.classifyWithUsage).not.toHaveBeenCalled();
    expect(aiTokenUsageLogRepo.create).not.toHaveBeenCalled();
  });

  it('aciona Vision fallback quando OCR é curto demais (imagem)', async () => {
    ocr.extractAndTokenize.mockResolvedValueOnce({
      text: 'oi',
      tokenizedText: 'oi',
      confidence: 0.4,
      pageCount: 1,
      pagesProcessed: 1,
      truncatedPages: 0,
      source: 'image',
      pages: [],
      durationMs: 8,
      warnings: [],
    });

    visionFallback.classifyImage.mockResolvedValueOnce({
      classification: {
        kind: 'identity_document',
        confidence: 0.92,
        suggestedDocumentType: 'personal_document',
        extracted: { patient: { name: 'Maria Vision', cpf: '{{cpf_1}}' } },
        durationMs: 1500,
        model: 'gpt-4o',
      },
      usage: {
        promptTokens: 800,
        completionTokens: 120,
        totalTokens: 920,
        model: 'gpt-4o',
        latencyMs: 1500,
      },
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending({
        contentType: 'image/jpeg',
        fileName: 'rg.jpg',
        kind: 'image',
      }),
      intent: 'create_patient',
      conversationId: 'conv-1',
      messageSid: 'SM-FB-1',
    });

    expect(visionFallback.classifyImage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageMimeType: 'image/jpeg',
        intent: 'create_patient',
        conversationId: 'conv-1',
        messageSid: 'SM-FB-1',
      }),
    );
    expect(classifier.classifyWithUsage).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
    expect(result.usedVisionFallback).toBe(true);
    expect(result.classification?.kind).toBe('identity_document');

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

  it('aciona Vision fallback quando classifier text-only falha (imagem)', async () => {
    classifier.classifyWithUsage.mockRejectedValueOnce(
      new Error('quota exceeded'),
    );
    visionFallback.classifyImage.mockResolvedValueOnce({
      classification: {
        kind: 'medical_report',
        confidence: 0.78,
        suggestedDocumentType: 'medical_report',
        extracted: {},
        durationMs: 1100,
        model: 'gpt-4o',
      },
      usage: {
        promptTokens: 650,
        completionTokens: 90,
        totalTokens: 740,
        model: 'gpt-4o',
        latencyMs: 1100,
      },
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending({
        contentType: 'image/png',
        fileName: 'laudo.png',
        kind: 'image',
      }),
      intent: 'create_sc',
      conversationId: 'conv-1',
      messageSid: 'SM-FB-2',
    });

    expect(visionFallback.classifyImage).toHaveBeenCalled();
    expect(result.status).toBe('ok');
    expect(result.usedVisionFallback).toBe(true);

    // Como o classifier text-only LANÇOU EXCEÇÃO, não temos usage dele para
    // contabilizar — só o snapshot do Vision fallback. Isso é intencional:
    // o token usage só registra chamadas que retornaram com `usage` da OpenAI.
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

  it('NÃO aciona Vision fallback para PDFs (apenas imagens são suportadas)', async () => {
    ocr.extractAndTokenize.mockResolvedValueOnce({
      text: 'oi',
      tokenizedText: 'oi',
      confidence: 0.4,
      pageCount: 1,
      pagesProcessed: 1,
      truncatedPages: 0,
      source: 'pdf-native',
      pages: [],
      durationMs: 8,
      warnings: [],
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending(),
      intent: 'attach',
      conversationId: 'conv-1',
      messageSid: 'SM-3',
    });

    expect(visionFallback.classifyImage).not.toHaveBeenCalled();
    expect(result.status).toBe('ocr_empty');
    expect(classifier.classifyWithUsage).not.toHaveBeenCalled();
  });

  it('reporta classifier_failed quando classifier falha e Vision também falha', async () => {
    classifier.classifyWithUsage.mockRejectedValueOnce(
      new Error('quota exceeded'),
    );
    visionFallback.classifyImage.mockRejectedValueOnce(
      new Error('vision unreachable'),
    );

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending({
        contentType: 'image/png',
        fileName: 'x.png',
        kind: 'image',
      }),
      intent: 'create_sc',
      conversationId: 'conv-1',
      messageSid: 'SM-4',
    });

    expect(result.status).toBe('classifier_failed');
    expect(result.errorMessage).toContain('classificá-lo');
    expect(dispatcher.savePending).not.toHaveBeenCalled();
  });

  it('encerra com ocr_empty quando extractAndTokenize lança exceção e mime não é imagem', async () => {
    ocr.extractAndTokenize.mockRejectedValueOnce(new Error('tesseract dead'));

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending(),
      intent: 'attach',
      conversationId: 'conv-1',
      messageSid: 'SM-5',
    });

    expect(result.status).toBe('ocr_empty');
    expect(classifier.classifyWithUsage).not.toHaveBeenCalled();
    expect(visionFallback.classifyImage).not.toHaveBeenCalled();
  });

  it('aciona Vision quando classifier text-only retorna confidence baixa em imagem', async () => {
    classifier.classifyWithUsage.mockResolvedValueOnce({
      classification: {
        kind: 'unknown',
        confidence: 0.3,
        suggestedDocumentType: 'additional_document',
        extracted: {},
        durationMs: 50,
        model: 'gpt-4o-mini',
      },
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        model: 'gpt-4o-mini',
        latencyMs: 50,
      },
    });
    visionFallback.classifyImage.mockResolvedValueOnce({
      classification: {
        kind: 'medical_report',
        confidence: 0.85,
        suggestedDocumentType: 'medical_report',
        extracted: {},
        durationMs: 900,
        model: 'gpt-4o',
      },
      usage: {
        promptTokens: 600,
        completionTokens: 80,
        totalTokens: 680,
        model: 'gpt-4o',
        latencyMs: 900,
      },
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending({
        contentType: 'image/png',
        fileName: 'guia.png',
        kind: 'image',
      }),
      intent: 'attach',
      conversationId: 'conv-1',
      messageSid: 'SM-6',
    });

    expect(result.usedVisionFallback).toBe(true);
    expect(result.classification?.kind).toBe('medical_report');
    expect(aiTokenUsageLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        callsCount: 2,
        breakdown: expect.arrayContaining([
          expect.objectContaining({ stage: 'doc_classifier' }),
          expect.objectContaining({ stage: 'doc_vision_fallback' }),
        ]),
      }),
    );
  });

  it('quando Vision fallback está desabilitado, mantém erro do classifier', async () => {
    visionFallback.isEnabled.mockReturnValue(false);
    classifier.classifyWithUsage.mockRejectedValueOnce(
      new Error('quota exceeded'),
    );

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending({
        contentType: 'image/png',
        fileName: 'x.png',
        kind: 'image',
      }),
      intent: 'create_sc',
      conversationId: 'conv-1',
      messageSid: 'SM-7',
    });

    expect(visionFallback.classifyImage).not.toHaveBeenCalled();
    expect(result.status).toBe('classifier_failed');
  });
});
