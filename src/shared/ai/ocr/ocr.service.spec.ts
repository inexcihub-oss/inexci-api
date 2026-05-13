import { ConfigService } from '@nestjs/config';
import { PiiVaultService } from '../services/pii-vault.service';
import { OcrService } from './ocr.service';
import { OcrUnsupportedMimeError } from './ocr.types';

const recognizeMock = jest.fn();
const terminateMock = jest.fn();
const createWorkerMock = jest.fn();

jest.mock('tesseract.js', () => ({
  __esModule: true,
  createWorker: (lang?: any, oem?: any, options?: any) =>
    createWorkerMock(lang, oem, options),
}));

const sharpInstance = {
  rotate: jest.fn().mockReturnThis(),
  grayscale: jest.fn().mockReturnThis(),
  normalize: jest.fn().mockReturnThis(),
  resize: jest.fn().mockReturnThis(),
  png: jest.fn().mockReturnThis(),
  toBuffer: jest.fn(),
};
const sharpMock: jest.Mock = jest.fn(() => sharpInstance);

jest.mock('sharp', () => ({
  __esModule: true,
  default: (input: any) => sharpMock(input),
}));

const getTextMock = jest.fn();
const getScreenshotMock = jest.fn();
const destroyMock = jest.fn();

class FakePDFParse {
  constructor(public readonly opts: any) {}
  getText = (...args: any[]) => getTextMock(...args);
  getScreenshot = (...args: any[]) => getScreenshotMock(...args);
  destroy = (...args: any[]) => destroyMock(...args);
}

jest.mock('pdf-parse', () => ({
  __esModule: true,
  PDFParse: FakePDFParse,
}));

function buildConfigService(
  overrides: Record<string, any> = {},
): ConfigService {
  const base: Record<string, any> = {
    AI_DOC_OCR_LANG: 'por',
    AI_DOC_MAX_PAGES: 5,
    ...overrides,
  };
  return {
    get: jest.fn((key: string, defaultValue?: any) =>
      key in base ? base[key] : defaultValue,
    ),
  } as unknown as ConfigService;
}

describe('OcrService', () => {
  let piiVault: PiiVaultService;
  let service: OcrService;

  beforeEach(() => {
    jest.clearAllMocks();

    sharpInstance.toBuffer.mockResolvedValue(Buffer.from('preprocessed'));

    createWorkerMock.mockResolvedValue({
      recognize: recognizeMock,
      terminate: terminateMock,
    });

    piiVault = new PiiVaultService();
    service = new OcrService(buildConfigService(), piiVault);
  });

  afterEach(async () => {
    await service.onModuleDestroy().catch(() => undefined);
  });

  it('rejeita mimeType não suportado', async () => {
    await expect(
      service.extract({
        buffer: Buffer.from('x'),
        mimeType: 'application/zip',
      }),
    ).rejects.toBeInstanceOf(OcrUnsupportedMimeError);
  });

  it('extrai texto de imagem usando tesseract com pré-processamento sharp', async () => {
    recognizeMock.mockResolvedValueOnce({
      data: { text: '  Laudo do paciente  ', confidence: 87 },
    });

    const result = await service.extract({
      buffer: Buffer.from('imagem original'),
      mimeType: 'image/jpeg',
    });

    expect(sharpMock).toHaveBeenCalledTimes(1);
    expect(sharpInstance.rotate).toHaveBeenCalled();
    expect(sharpInstance.grayscale).toHaveBeenCalled();
    expect(sharpInstance.normalize).toHaveBeenCalled();
    expect(sharpInstance.resize).toHaveBeenCalledWith({
      width: 2000,
      withoutEnlargement: true,
    });
    expect(recognizeMock).toHaveBeenCalledTimes(1);
    expect(recognizeMock).toHaveBeenCalledWith(Buffer.from('preprocessed'));

    expect(result.source).toBe('image');
    expect(result.pageCount).toBe(1);
    expect(result.pagesProcessed).toBe(1);
    expect(result.text).toBe('Laudo do paciente');
    expect(result.confidence).toBeCloseTo(0.87, 2);
    expect(result.warnings).toEqual([]);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].source).toBe('ocr');
  });

  it('reutiliza worker do tesseract entre chamadas', async () => {
    recognizeMock
      .mockResolvedValueOnce({ data: { text: 'a', confidence: 80 } })
      .mockResolvedValueOnce({ data: { text: 'b', confidence: 80 } });

    await service.extract({
      buffer: Buffer.from('a'),
      mimeType: 'image/png',
    });
    await service.extract({
      buffer: Buffer.from('b'),
      mimeType: 'image/png',
    });

    expect(createWorkerMock).toHaveBeenCalledTimes(1);
  });

  it('mantém raw text quando preprocess sharp falha', async () => {
    sharpInstance.toBuffer.mockRejectedValueOnce(new Error('vips quebrou'));
    recognizeMock.mockResolvedValueOnce({
      data: { text: 'fallback', confidence: 60 },
    });

    const result = await service.extract({
      buffer: Buffer.from('original'),
      mimeType: 'image/png',
    });

    expect(recognizeMock).toHaveBeenCalledWith(Buffer.from('original'));
    expect(result.warnings).toEqual([
      expect.stringMatching(/^preprocess_failed:/),
    ]);
  });

  it('REGRESSION: extractAndTokenize NÃO transforma laudo grande em payload_blob', async () => {
    // Bug observado em prod: laudos médicos de PDF (frequentemente
    // > 1500 chars) saíam como UM ÚNICO `{{payload_blob_1}}`, fazendo o
    // classifier text-only devolver `kind=unknown, confidence=0.5,
    // extracted={}`. O fix foi remover o `payload_blob` automático do
    // PII Vault — apenas dados sensíveis estruturados (CPF/telefone/
    // email) seguem sendo tokenizados.
    const longLaudo =
      'Paciente Jean Pierre Pereira Proximo, CPF 529.982.247-25. ' +
      'Diagnóstico: artrose cervical em 2 níveis. Indicação: artrodese cervical. ' +
      'Procedimento proposto: descompressão e fusão cervical anterior. ' +
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
    expect(longLaudo.length).toBeGreaterThan(1500);
    getTextMock.mockResolvedValueOnce({ text: longLaudo, total: 1 });

    const result = await service.extractAndTokenize(
      {
        buffer: Buffer.from('%PDF fake'),
        mimeType: 'application/pdf',
      },
      'session-regression',
    );

    expect(result.text).toContain('Jean Pierre Pereira Proximo');
    expect(result.tokenizedText).toContain('Jean Pierre Pereira Proximo');
    expect(result.tokenizedText).toContain('artrodese cervical');
    expect(result.tokenizedText).not.toMatch(/\{\{payload_blob_\d+\}\}/);
    expect(result.tokenizedText).toMatch(/\{\{cpf_\d+\}\}/);
    expect(result.tokenizedText).not.toContain('529.982.247-25');
  });

  it('extrai PDF nativo via text-layer quando há texto suficiente', async () => {
    const longText = 'Relatório de cirurgia '.repeat(20);
    getTextMock.mockResolvedValueOnce({ text: longText, total: 3 });

    const result = await service.extract({
      buffer: Buffer.from('%PDF-1.4 fake'),
      mimeType: 'application/pdf',
    });

    expect(getTextMock).toHaveBeenCalledTimes(1);
    expect(getScreenshotMock).not.toHaveBeenCalled();
    expect(destroyMock).toHaveBeenCalled();
    expect(result.source).toBe('pdf-native');
    expect(result.pageCount).toBe(3);
    expect(result.pagesProcessed).toBe(1);
    expect(result.confidence).toBeCloseTo(0.99, 2);
    expect(result.text).toContain('Relatório de cirurgia');
    expect(result.pages[0].source).toBe('text-layer');
  });

  it('cai para rasterização + Tesseract quando text-layer é insuficiente', async () => {
    getTextMock.mockResolvedValueOnce({ text: '   ', total: 2 });
    getScreenshotMock.mockResolvedValueOnce({
      pages: [
        { pageNumber: 1, data: Buffer.from('png-1') },
        { pageNumber: 2, data: Buffer.from('png-2') },
      ],
    });
    recognizeMock
      .mockResolvedValueOnce({
        data: { text: 'pagina um', confidence: 90 },
      })
      .mockResolvedValueOnce({
        data: { text: 'pagina dois', confidence: 70 },
      });

    const result = await service.extract({
      buffer: Buffer.from('%PDF scan'),
      mimeType: 'application/pdf',
    });

    expect(getScreenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scale: 2,
        first: 5,
        imageBuffer: true,
        imageDataUrl: false,
      }),
    );
    expect(recognizeMock).toHaveBeenCalledTimes(2);
    expect(result.source).toBe('pdf-rasterized');
    expect(result.pageCount).toBe(2);
    expect(result.pagesProcessed).toBe(2);
    expect(result.text).toContain('pagina um');
    expect(result.text).toContain('pagina dois');
    expect(result.confidence).toBeCloseTo(0.8, 2);
    expect(result.pages.map((p) => p.source)).toEqual(['ocr', 'ocr']);
  });

  it('respeita AI_DOC_MAX_PAGES truncando páginas excedentes', async () => {
    service = new OcrService(
      buildConfigService({ AI_DOC_MAX_PAGES: 1 }),
      piiVault,
    );

    getTextMock.mockResolvedValueOnce({ text: '   ', total: 4 });
    getScreenshotMock.mockResolvedValueOnce({
      pages: [{ pageNumber: 1, data: Buffer.from('png-1') }],
    });
    recognizeMock.mockResolvedValueOnce({
      data: { text: 'so a primeira', confidence: 88 },
    });

    const result = await service.extract({
      buffer: Buffer.from('%PDF many pages'),
      mimeType: 'application/pdf',
    });

    expect(getScreenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ first: 1 }),
    );
    expect(result.pageCount).toBe(4);
    expect(result.pagesProcessed).toBe(1);
    expect(result.truncatedPages).toBe(3);
  });

  it('extractAndTokenize substitui PII estruturada antes de devolver', async () => {
    sharpInstance.toBuffer.mockResolvedValueOnce(Buffer.from('p'));
    recognizeMock.mockResolvedValueOnce({
      data: {
        text: 'CPF 123.456.789-00 contato (31) 98888-7777 email a@b.com',
        confidence: 90,
      },
    });

    const result = await service.extractAndTokenize(
      { buffer: Buffer.from('img'), mimeType: 'image/png' },
      'session-1',
    );

    expect(result.text).toContain('123.456.789-00');
    expect(result.tokenizedText).not.toContain('123.456.789-00');
    expect(result.tokenizedText).not.toContain('98888-7777');
    expect(result.tokenizedText).not.toContain('a@b.com');
    expect(result.tokenizedText).toMatch(/\{\{cpf_\d+\}\}/);
    expect(result.tokenizedText).toMatch(/\{\{phone_\d+\}\}/);
    expect(result.tokenizedText).toMatch(/\{\{email_\d+\}\}/);
  });

  it('reporta warning se getScreenshot falha', async () => {
    getTextMock.mockResolvedValueOnce({ text: '', total: 0 });
    getScreenshotMock.mockRejectedValueOnce(new Error('canvas indisponível'));

    const result = await service.extract({
      buffer: Buffer.from('%PDF broken'),
      mimeType: 'application/pdf',
    });

    expect(result.text).toBe('');
    expect(result.confidence).toBe(0);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^pdf_screenshot_failed:/),
      ]),
    );
  });
});
