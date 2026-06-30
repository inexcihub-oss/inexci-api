import { DocumentExtractionService } from './document-extraction.service';
import { OcrService } from './ocr.service';
import { DocumentClassifierService } from './document-classifier.service';
import { DocumentVisionFallbackService } from './document-vision-fallback.service';
import { PiiVaultService } from '../services/pii-vault.service';

const buildClassification = (overrides: Record<string, unknown> = {}) => ({
  kind: 'medical_report' as const,
  confidence: 0.88,
  suggestedDocumentType: 'medical_report',
  extracted: { patient: { name: 'Joao', cpf: '{{cpf_1}}' } },
  durationMs: 50,
  model: 'gpt-4o-mini',
  ...overrides,
});

const buildOcrResult = (
  text = 'texto longo o suficiente aqui para passar o mínimo',
) => ({
  text,
  tokenizedText: text.replace(/\d{11}/g, '{{cpf_1}}'),
  confidence: 0.91,
  pageCount: 1,
  pagesProcessed: 1,
  truncatedPages: 0,
  source: 'pdf-native' as const,
  pages: [],
  durationMs: 12,
  warnings: [],
});

describe('DocumentExtractionService', () => {
  let ocr: jest.Mocked<Partial<OcrService>>;
  let classifier: jest.Mocked<Partial<DocumentClassifierService>>;
  let visionFallback: jest.Mocked<Partial<DocumentVisionFallbackService>>;
  let piiVault: jest.Mocked<Partial<PiiVaultService>>;
  let service: DocumentExtractionService;

  beforeEach(() => {
    ocr = {
      extractAndTokenize: jest.fn().mockResolvedValue(buildOcrResult()),
      rasterizeFirstPdfPage: jest.fn().mockResolvedValue(null),
    };
    classifier = {
      classifyWithUsage: jest.fn().mockResolvedValue({
        classification: buildClassification(),
        usage: {
          promptTokens: 320,
          completionTokens: 110,
          totalTokens: 430,
          model: 'gpt-4o-mini',
          latencyMs: 50,
        },
      }),
    };
    visionFallback = {
      isEnabled: jest.fn().mockReturnValue(true),
      isSupportedImageMime: jest.fn((mime: string) =>
        ['image/jpeg', 'image/png', 'image/webp'].includes(mime),
      ),
      classifyImage: jest.fn(),
    };
    piiVault = {
      detokenize: jest.fn((_sessionId: string, text: string) =>
        text.replace('{{cpf_1}}', '12345678901'),
      ),
    };

    service = new DocumentExtractionService(
      ocr as OcrService,
      classifier as DocumentClassifierService,
      visionFallback as DocumentVisionFallbackService,
      piiVault as PiiVaultService,
    );
  });

  it('roda OCR + classifier e retorna ok com classification', async () => {
    const result = await service.extractFromBuffer({
      buffer: Buffer.from('pdf'),
      mimeType: 'application/pdf',
      sessionId: 'sess-1',
      intent: 'create_sc',
    });

    expect(ocr.extractAndTokenize).toHaveBeenCalled();
    expect(classifier.classifyWithUsage).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'create_sc' }),
    );
    expect(result.status).toBe('ok');
    expect(result.classification?.kind).toBe('medical_report');
    expect(result.usedVisionFallback).toBe(false);
    expect(result.usageSnapshots).toHaveLength(1);
    expect(result.usageSnapshots[0].stage).toBe('doc_classifier');
  });

  it('retorna ocr_empty quando OCR extrai texto muito curto', async () => {
    (ocr.extractAndTokenize as jest.Mock).mockResolvedValueOnce(
      buildOcrResult('oi'),
    );

    const result = await service.extractFromBuffer({
      buffer: Buffer.from('img'),
      mimeType: 'image/jpeg',
      sessionId: 'sess-2',
    });

    expect(result.status).toBe('ocr_empty');
    expect(result.classification).toBeNull();
    expect(classifier.classifyWithUsage).not.toHaveBeenCalled();
  });

  it('ativa Vision fallback quando OCR é curto demais (imagem)', async () => {
    (ocr.extractAndTokenize as jest.Mock).mockResolvedValueOnce(
      buildOcrResult('oi'),
    );
    (visionFallback.classifyImage as jest.Mock).mockResolvedValueOnce({
      classification: buildClassification({ kind: 'identity_document' }),
      usage: {
        promptTokens: 800,
        completionTokens: 120,
        totalTokens: 920,
        model: 'gpt-4o',
        latencyMs: 1500,
      },
    });

    const result = await service.extractFromBuffer({
      buffer: Buffer.from('img'),
      mimeType: 'image/jpeg',
      sessionId: 'sess-3',
    });

    expect(visionFallback.classifyImage).toHaveBeenCalled();
    expect(result.status).toBe('ok');
    expect(result.usedVisionFallback).toBe(true);
    expect(result.classification?.kind).toBe('identity_document');
    expect(result.usageSnapshots[0].stage).toBe('doc_vision_fallback');
  });

  it('ativa Vision para PDF quando OCR é insuficiente: rasteriza e envia ao vision', async () => {
    (ocr.extractAndTokenize as jest.Mock).mockResolvedValueOnce(
      buildOcrResult('oi'),
    );
    const rasterized = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    (ocr.rasterizeFirstPdfPage as jest.Mock).mockResolvedValueOnce(rasterized);
    (visionFallback.classifyImage as jest.Mock).mockResolvedValueOnce({
      classification: buildClassification(),
      usage: {
        promptTokens: 700,
        completionTokens: 90,
        totalTokens: 790,
        model: 'gpt-4o',
        latencyMs: 1200,
      },
    });

    const result = await service.extractFromBuffer({
      buffer: Buffer.from('pdf'),
      mimeType: 'application/pdf',
      sessionId: 'sess-4',
    });

    expect(ocr.rasterizeFirstPdfPage).toHaveBeenCalledWith(expect.any(Buffer));
    expect(visionFallback.classifyImage).toHaveBeenCalledWith(
      expect.objectContaining({ imageMimeType: 'image/png' }),
    );
    expect(result.usedVisionFallback).toBe(true);
  });

  it('retorna ocr_exception quando OCR lança erro', async () => {
    (ocr.extractAndTokenize as jest.Mock).mockRejectedValueOnce(
      new Error('tesseract dead'),
    );
    (ocr.rasterizeFirstPdfPage as jest.Mock).mockResolvedValueOnce(null);

    const result = await service.extractFromBuffer({
      buffer: Buffer.from('pdf'),
      mimeType: 'application/pdf',
      sessionId: 'sess-5',
    });

    expect(result.status).toBe('ocr_exception');
    expect(result.classification).toBeNull();
  });

  it('retorna classifier_failed quando classifier e vision falham', async () => {
    (classifier.classifyWithUsage as jest.Mock).mockRejectedValueOnce(
      new Error('quota'),
    );
    (visionFallback.classifyImage as jest.Mock).mockRejectedValueOnce(
      new Error('vision down'),
    );

    const result = await service.extractFromBuffer({
      buffer: Buffer.from('img'),
      mimeType: 'image/png',
      sessionId: 'sess-6',
    });

    expect(result.status).toBe('classifier_failed');
    expect(result.classification).toBeNull();
  });

  it('regression: ativa Vision quando confidence < 0.75', async () => {
    (classifier.classifyWithUsage as jest.Mock).mockResolvedValueOnce({
      classification: buildClassification({
        kind: 'unknown',
        confidence: 0.74,
        extracted: {},
      }),
      usage: {
        promptTokens: 200,
        completionTokens: 30,
        totalTokens: 230,
        model: 'gpt-4o-mini',
        latencyMs: 50,
      },
    });
    (visionFallback.classifyImage as jest.Mock).mockResolvedValueOnce({
      classification: buildClassification({
        kind: 'medical_report',
        confidence: 0.9,
      }),
      usage: {
        promptTokens: 700,
        completionTokens: 80,
        totalTokens: 780,
        model: 'gpt-4o',
        latencyMs: 1100,
      },
    });

    const result = await service.extractFromBuffer({
      buffer: Buffer.from('img'),
      mimeType: 'image/png',
      sessionId: 'sess-7',
    });

    expect(visionFallback.classifyImage).toHaveBeenCalled();
    expect(result.usedVisionFallback).toBe(true);
    expect(result.classification?.kind).toBe('medical_report');
  });

  it('não aciona Vision quando confidence == 0.75 e extração veio útil', async () => {
    (classifier.classifyWithUsage as jest.Mock).mockResolvedValueOnce({
      classification: buildClassification({
        kind: 'medical_report',
        confidence: 0.75,
        extracted: { patient: { name: 'Joao' } },
      }),
      usage: {
        promptTokens: 200,
        completionTokens: 30,
        totalTokens: 230,
        model: 'gpt-4o-mini',
        latencyMs: 50,
      },
    });

    const result = await service.extractFromBuffer({
      buffer: Buffer.from('img'),
      mimeType: 'image/png',
      sessionId: 'sess-7b',
    });

    expect(visionFallback.classifyImage).not.toHaveBeenCalled();
    expect(result.usedVisionFallback).toBe(false);
    expect(result.classification?.confidence).toBe(0.75);
  });

  it('detokenizeExtracted=true substitui placeholders nos campos extraídos', async () => {
    const result = await service.extractFromBuffer({
      buffer: Buffer.from('pdf'),
      mimeType: 'application/pdf',
      sessionId: 'sess-dtok',
      detokenizeExtracted: true,
    });

    expect(result.status).toBe('ok');
    expect(piiVault.detokenize).toHaveBeenCalled();
    expect(result.classification?.extracted.patient?.cpf).toBe('12345678901');
  });

  it('sem detokenizeExtracted, mantém placeholders intactos', async () => {
    const result = await service.extractFromBuffer({
      buffer: Buffer.from('pdf'),
      mimeType: 'application/pdf',
      sessionId: 'sess-no-dtok',
    });

    expect(result.status).toBe('ok');
    expect(piiVault.detokenize).not.toHaveBeenCalled();
    expect(result.classification?.extracted.patient?.cpf).toBe('{{cpf_1}}');
  });

  describe('isExtractedEffectivelyEmpty', () => {
    it('retorna true quando extracted é completamente vazio', () => {
      expect(
        service.isExtractedEffectivelyEmpty({
          kind: 'unknown',
          confidence: 0.5,
          extracted: {},
          suggestedDocumentType: 'additional_document',
          durationMs: 0,
          model: 'gpt-4o-mini',
        }),
      ).toBe(true);
    });

    it('retorna false quando há paciente', () => {
      expect(
        service.isExtractedEffectivelyEmpty({
          kind: 'medical_report',
          confidence: 0.9,
          extracted: { patient: { name: 'Joao' } },
          suggestedDocumentType: 'medical_report',
          durationMs: 0,
          model: 'gpt-4o-mini',
        }),
      ).toBe(false);
    });

    it('retorna false quando há TUSS', () => {
      expect(
        service.isExtractedEffectivelyEmpty({
          kind: 'surgery_request',
          confidence: 0.9,
          extracted: { tuss: [{ code: '3.07.15.091', description: 'x' }] },
          suggestedDocumentType: 'medical_report',
          durationMs: 0,
          model: 'gpt-4o-mini',
        }),
      ).toBe(false);
    });
  });
});
