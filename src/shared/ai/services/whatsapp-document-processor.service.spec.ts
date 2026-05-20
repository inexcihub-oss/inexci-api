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
      rasterizeFirstPdfPage: jest.fn().mockResolvedValue(null),
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

  it('PDF: rasteriza primeira página e envia ao Vision quando OCR é insuficiente', async () => {
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
    const rasterized = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    ocr.rasterizeFirstPdfPage.mockResolvedValueOnce(rasterized);
    visionFallback.classifyImage.mockResolvedValueOnce({
      classification: {
        kind: 'medical_report',
        confidence: 0.82,
        suggestedDocumentType: 'medical_report',
        extracted: { patient: { name: 'Joao Vision' } },
        durationMs: 1200,
        model: 'gpt-4o',
      },
      usage: {
        promptTokens: 700,
        completionTokens: 90,
        totalTokens: 790,
        model: 'gpt-4o',
        latencyMs: 1200,
      },
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending(),
      intent: 'attach',
      conversationId: 'conv-1',
      messageSid: 'SM-3',
    });

    expect(ocr.rasterizeFirstPdfPage).toHaveBeenCalledWith(expect.any(Buffer));
    expect(visionFallback.classifyImage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageBuffer: rasterized,
        imageMimeType: 'image/png',
      }),
    );
    expect(result.status).toBe('ok');
    expect(result.usedVisionFallback).toBe(true);
    expect(result.classification?.kind).toBe('medical_report');
  });

  it('PDF: cai para ocr_empty quando rasterização falha (e nada salva no Vision)', async () => {
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
    ocr.rasterizeFirstPdfPage.mockResolvedValueOnce(null);

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending(),
      intent: 'attach',
      conversationId: 'conv-1',
      messageSid: 'SM-3b',
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

  it('encerra com ocr_empty quando extractAndTokenize lança exceção em PDF e rasterização falha', async () => {
    ocr.extractAndTokenize.mockRejectedValueOnce(new Error('tesseract dead'));
    ocr.rasterizeFirstPdfPage.mockResolvedValueOnce(null);

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

  it('regression: dispara Vision quando classifier devolve EXATAMENTE confidence=0.5 (limiar inclusivo)', async () => {
    // Bug observado em prod (PDF "Jean Pierre"): classifier devolvia
    // confidence=0.5 e o trigger usava `<` 0.5, então o Vision NUNCA
    // rodava e o usuário ficava preso em "Documento (tipo não
    // identificado) — Confiança: 50%". Threshold ajustado para `<= 0.6`.
    classifier.classifyWithUsage.mockResolvedValueOnce({
      classification: {
        kind: 'unknown',
        confidence: 0.5,
        suggestedDocumentType: 'additional_document',
        extracted: {},
        durationMs: 50,
        model: 'gpt-4o-mini',
      },
      usage: {
        promptTokens: 200,
        completionTokens: 30,
        totalTokens: 230,
        model: 'gpt-4o-mini',
        latencyMs: 50,
      },
    });
    visionFallback.classifyImage.mockResolvedValueOnce({
      classification: {
        kind: 'medical_report',
        confidence: 0.9,
        suggestedDocumentType: 'medical_report',
        extracted: { patient: { name: 'Jean Pierre' } },
        durationMs: 1100,
        model: 'gpt-4o',
      },
      usage: {
        promptTokens: 700,
        completionTokens: 80,
        totalTokens: 780,
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
      messageSid: 'SM-REG-CONF50',
    });

    expect(visionFallback.classifyImage).toHaveBeenCalled();
    expect(result.usedVisionFallback).toBe(true);
    expect(result.classification?.kind).toBe('medical_report');
  });

  it('dispara Vision quando classifier devolve kind=unknown (mesmo com confidence alta)', async () => {
    classifier.classifyWithUsage.mockResolvedValueOnce({
      classification: {
        kind: 'unknown',
        confidence: 0.95,
        suggestedDocumentType: 'additional_document',
        extracted: {},
        durationMs: 40,
        model: 'gpt-4o-mini',
      },
      usage: {
        promptTokens: 150,
        completionTokens: 20,
        totalTokens: 170,
        model: 'gpt-4o-mini',
        latencyMs: 40,
      },
    });
    visionFallback.classifyImage.mockResolvedValueOnce({
      classification: {
        kind: 'identity_document',
        confidence: 0.88,
        suggestedDocumentType: 'personal_document',
        extracted: { patient: { name: 'Maria' } },
        durationMs: 800,
        model: 'gpt-4o',
      },
      usage: {
        promptTokens: 600,
        completionTokens: 60,
        totalTokens: 660,
        model: 'gpt-4o',
        latencyMs: 800,
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
      messageSid: 'SM-REG-UNKNOWN',
    });

    expect(visionFallback.classifyImage).toHaveBeenCalled();
    expect(result.usedVisionFallback).toBe(true);
    expect(result.classification?.kind).toBe('identity_document');
  });

  it('dispara Vision quando classifier devolve extracted vazio (mesmo com kind reconhecido)', async () => {
    classifier.classifyWithUsage.mockResolvedValueOnce({
      classification: {
        kind: 'medical_report',
        confidence: 0.9,
        suggestedDocumentType: 'medical_report',
        extracted: {},
        durationMs: 50,
        model: 'gpt-4o-mini',
      },
      usage: {
        promptTokens: 180,
        completionTokens: 25,
        totalTokens: 205,
        model: 'gpt-4o-mini',
        latencyMs: 50,
      },
    });
    visionFallback.classifyImage.mockResolvedValueOnce({
      classification: {
        kind: 'medical_report',
        confidence: 0.92,
        suggestedDocumentType: 'medical_report',
        extracted: { patient: { name: 'Carlos' }, hospital: 'Sirio' },
        durationMs: 1000,
        model: 'gpt-4o',
      },
      usage: {
        promptTokens: 650,
        completionTokens: 90,
        totalTokens: 740,
        model: 'gpt-4o',
        latencyMs: 1000,
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
      messageSid: 'SM-REG-EMPTY',
    });

    expect(visionFallback.classifyImage).toHaveBeenCalled();
    expect(result.usedVisionFallback).toBe(true);
    expect(result.classification?.extracted?.patient?.name).toBe('Carlos');
  });

  it('userSummary é honesto quando extracted vazio: pede dados em vez de prometer SC', async () => {
    classifier.classifyWithUsage.mockResolvedValueOnce({
      classification: {
        kind: 'medical_report',
        confidence: 0.85,
        suggestedDocumentType: 'medical_report',
        extracted: {},
        durationMs: 40,
        model: 'gpt-4o-mini',
      },
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        model: 'gpt-4o-mini',
        latencyMs: 40,
      },
    });
    // Vision também devolve vazio (cenário do print do usuário).
    visionFallback.classifyImage.mockResolvedValueOnce({
      classification: {
        kind: 'medical_report',
        confidence: 0.85,
        suggestedDocumentType: 'medical_report',
        extracted: {},
        durationMs: 800,
        model: 'gpt-4o',
      },
      usage: {
        promptTokens: 500,
        completionTokens: 50,
        totalTokens: 550,
        model: 'gpt-4o',
        latencyMs: 800,
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
      messageSid: 'SM-EMPTY-SUMMARY',
    });

    expect(result.userSummary).toContain('Não consegui extrair dados úteis');
    expect(result.userSummary).toContain('nome do paciente');
    expect(result.userSummary).not.toContain('Posso seguir?');
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

  it('preview de SC inclui diagnóstico, procedimento sugerido, OPME completo e fornecedores', async () => {
    classifier.classifyWithUsage.mockResolvedValueOnce({
      classification: {
        kind: 'surgery_request',
        confidence: 0.95,
        suggestedDocumentType: 'medical_report',
        extracted: {
          patient: { name: 'Jean Pierre Pereira Proximo' },
          healthPlan: { name: 'Bradesco' },
          diagnosis:
            'Hérnia discal cervical médio-foraminal C5-C6 e C4-C5 com compressão radicular',
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
              brand: 'DIVA/NOVA SPINE',
            },
            { description: 'ANCORAS', qty: 4 },
          ],
          suggestedSuppliers: ['SINTEX', 'VITALITY', 'GUSMED'],
          laudoText:
            'Paciente com queixa de dor radicular braquial à esquerda incapacitante. RNM cervical com hérnia discal C5-C6 e C4-C5 com compressão radicular. Indicado procedimento cirúrgico com artrodese cervical.',
        },
        durationMs: 60,
        model: 'gpt-4o-mini',
      },
      usage: {
        promptTokens: 800,
        completionTokens: 400,
        totalTokens: 1200,
        model: 'gpt-4o-mini',
        latencyMs: 60,
      },
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending({
        contentType: 'application/pdf',
        fileName: 'laudo-jean-pierre.pdf',
        kind: 'pdf',
      }),
      intent: 'create_sc',
      conversationId: 'conv-rich',
      messageSid: 'SM-RICH',
    });

    expect(result.status).toBe('ok');
    const summary = result.userSummary;
    expect(summary).toContain('Jean Pierre Pereira Proximo');
    expect(summary).toContain('Bradesco');
    expect(summary).not.toContain('52.87165-6');
    expect(summary).not.toContain('CRM');
    expect(summary).toContain('Diagnóstico: Hérnia discal cervical');
    expect(summary).toContain(
      'Procedimento sugerido: Artrodese cervical anterior C5-C6 e C4-C5',
    );
    expect(summary).toContain('TUSS (2):');
    expect(summary).toContain('3.07.15.091');
    expect(summary).toContain('OPME (2):');
    expect(summary).toContain(
      '2× CAGES STAND ALONE [SINTEX / DIVA/NOVA SPINE]',
    );
    expect(summary).toContain('4× ANCORAS');
    expect(summary).toContain(
      'Fornecedores sugeridos: SINTEX, VITALITY, GUSMED',
    );
    expect(summary).toContain('Laudo (trecho):');
    expect(summary).toContain('artrodese cervical');
    // Modo auto-create: a mensagem deve ser imperativa, não pedir "responda sim".
    expect(summary).toContain('Já vou montar a solicitação cirúrgica');
    expect(summary).not.toContain('Posso seguir?');
  });

  it('preview com poucos dados continua pedindo confirmação ("Posso seguir?")', async () => {
    classifier.classifyWithUsage.mockResolvedValueOnce({
      classification: {
        kind: 'medical_report',
        confidence: 0.85,
        suggestedDocumentType: 'medical_report',
        extracted: {
          patient: { name: 'Maria Costa' },
          // Sem procedimento, sem TUSS, sem OPME, sem laudo: contexto pobre.
        },
        durationMs: 50,
        model: 'gpt-4o-mini',
      },
      usage: {
        promptTokens: 200,
        completionTokens: 50,
        totalTokens: 250,
        model: 'gpt-4o-mini',
        latencyMs: 50,
      },
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending(),
      intent: 'create_sc',
      conversationId: 'conv-poor',
      messageSid: 'SM-POOR',
    });

    expect(result.userSummary).toContain('Maria Costa');
    expect(result.userSummary).toContain('Posso seguir?');
    expect(result.userSummary).not.toContain('Já vou montar');
  });

  it('trunca userSummary longo para evitar erro de limite do WhatsApp', async () => {
    classifier.classifyWithUsage.mockResolvedValueOnce({
      classification: {
        kind: 'surgery_request',
        confidence: 0.94,
        suggestedDocumentType: 'medical_report',
        extracted: {
          patient: { name: 'Paciente Muito Longo de Teste' },
          diagnosis: 'Diagnóstico '.repeat(60),
          suggestedProcedureName: 'Procedimento '.repeat(50),
          tuss: Array.from({ length: 40 }, (_, i) => ({
            code: `3.07.${String(100 + i)}`,
            description: `Descrição extensa ${i} `.repeat(6),
          })),
          opme: Array.from({ length: 20 }, (_, i) => ({
            description: `Item OPME ${i} `.repeat(8),
            qty: 1,
            supplier: `Fornecedor ${i}`,
            brand: `Marca ${i}`,
          })),
          laudoText: 'Trecho longo de laudo '.repeat(200),
        },
        durationMs: 70,
        model: 'gpt-4o-mini',
      },
      usage: {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        model: 'gpt-4o-mini',
        latencyMs: 70,
      },
    });

    const result = await service.processPendingDocument({
      phone: '+5511988887777',
      pending: buildPending(),
      intent: 'create_sc',
      conversationId: 'conv-long',
      messageSid: 'SM-LONG',
    });

    expect(result.status).toBe('ok');
    expect((result.userSummary ?? '').length).toBeLessThanOrEqual(1400);
    expect(result.userSummary).toContain(
      'Resumo reduzido para caber no WhatsApp',
    );
  });
});
