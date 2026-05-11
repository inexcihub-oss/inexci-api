import { ConfigService } from '@nestjs/config';
import { OpenaiService } from '../services/openai.service';
import { PiiVaultService } from '../services/pii-vault.service';
import { DocumentVisionFallbackService } from './document-vision-fallback.service';

describe('DocumentVisionFallbackService', () => {
  let openai: jest.Mocked<OpenaiService>;
  let configService: ConfigService;
  let piiVault: PiiVaultService;
  let service: DocumentVisionFallbackService;

  beforeEach(() => {
    openai = {
      chatCompletion: jest.fn(),
    } as any;

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'AI_DOC_VISION_FALLBACK_MODEL') return 'gpt-4o';
        if (key === 'AI_DOC_VISION_FALLBACK_ENABLED') return 'true';
        return defaultValue;
      }),
    } as any;

    piiVault = new PiiVaultService();
    piiVault.startSession('conv-1');

    service = new DocumentVisionFallbackService(
      openai,
      configService,
      piiVault,
    );
  });

  function buildLlmResponse(payload: object, usage?: any) {
    return {
      choices: [
        {
          message: { content: JSON.stringify(payload) },
        },
      ],
      usage: usage ?? {
        prompt_tokens: 250,
        completion_tokens: 80,
        total_tokens: 330,
      },
    } as any;
  }

  it('rejeita MIME não suportado (PDF)', async () => {
    await expect(
      service.classifyImage({
        imageBuffer: Buffer.from('pdf-bytes'),
        imageMimeType: 'application/pdf',
        conversationId: 'conv-1',
      }),
    ).rejects.toThrow(/não suportado/);
    expect(openai.chatCompletion).not.toHaveBeenCalled();
  });

  it('rejeita quando o flag de fallback está desligado', async () => {
    (configService.get as jest.Mock).mockImplementation(
      (key: string, defaultValue?: any) => {
        if (key === 'AI_DOC_VISION_FALLBACK_ENABLED') return 'false';
        if (key === 'AI_DOC_VISION_FALLBACK_MODEL') return 'gpt-4o';
        return defaultValue;
      },
    );

    await expect(
      service.classifyImage({
        imageBuffer: Buffer.from('img'),
        imageMimeType: 'image/png',
        conversationId: 'conv-1',
      }),
    ).rejects.toThrow(/desabilitado/);
    expect(openai.chatCompletion).not.toHaveBeenCalled();
  });

  it('chama gpt-4o com data: URL e response_format json_schema strict', async () => {
    openai.chatCompletion.mockResolvedValueOnce(
      buildLlmResponse({
        kind: 'identity_document',
        confidence: 0.95,
        suggestedDocumentType: 'personal_document',
        ambiguity: null,
        extracted: {
          patient: {
            name: 'JOAO DA SILVA',
            cpf: '529.982.247-25',
            birthDate: '1990-05-10',
            rg: 'MG-12.345.678',
            motherName: null,
            address: null,
            phone: null,
          },
          hospital: null,
          healthPlan: { name: null, planId: null, validity: null },
          tuss: null,
          cid: null,
          opme: null,
          laudoText: null,
          doctorCRM: null,
          notes: null,
        },
      }),
    );

    const result = await service.classifyImage({
      imageBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      imageMimeType: 'image/png',
      intent: 'create_patient',
      conversationId: 'conv-1',
      messageSid: 'SM-vision-1',
    });

    expect(openai.chatCompletion).toHaveBeenCalledTimes(1);
    const callArgs = openai.chatCompletion.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o');
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.responseFormat).toEqual(
      expect.objectContaining({ type: 'json_schema' }),
    );
    expect((callArgs.responseFormat as any).json_schema?.strict).toBe(true);

    const userMessage = callArgs.messages[1];
    expect(userMessage.role).toBe('user');
    expect(Array.isArray(userMessage.content)).toBe(true);
    const imagePart = (userMessage.content as any[]).find(
      (p: any) => p.type === 'image_url',
    );
    expect(imagePart).toBeDefined();
    expect(imagePart.image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(imagePart.image_url.detail).toBe('high');

    expect(result.classification.kind).toBe('identity_document');
    expect(result.classification.suggestedDocumentType).toBe(
      'personal_document',
    );
    expect(result.classification.confidence).toBeCloseTo(0.95, 2);
    expect(result.classification.model).toBe('gpt-4o');

    // CPF do retorno foi tokenizado pelo PII Vault.
    expect(result.classification.extracted.patient?.cpf).toMatch(
      /^\{\{cpf_\d+\}\}$/,
    );
    expect(result.classification.extracted.patient?.name).toBe('JOAO DA SILVA');
    expect(result.classification.extracted.patient?.rg).toBe('MG-12.345.678');

    expect(result.usage).toEqual({
      promptTokens: 250,
      completionTokens: 80,
      totalTokens: 330,
      model: 'gpt-4o',
      latencyMs: expect.any(Number),
    });
  });

  it('tokeniza telefone e remove campos vazios do extracted', async () => {
    openai.chatCompletion.mockResolvedValueOnce(
      buildLlmResponse({
        kind: 'medical_report',
        confidence: 0.85,
        suggestedDocumentType: 'medical_report',
        ambiguity: null,
        extracted: {
          patient: {
            name: 'Ana Souza',
            cpf: null,
            birthDate: null,
            rg: null,
            motherName: null,
            address: null,
            phone: '(11) 98888-7777',
          },
          hospital: '',
          healthPlan: { name: null, planId: null, validity: null },
          tuss: [],
          cid: [],
          opme: [],
          laudoText: null,
          doctorCRM: null,
          notes: null,
        },
      }),
    );

    const result = await service.classifyImage({
      imageBuffer: Buffer.from('img'),
      imageMimeType: 'image/jpeg',
      conversationId: 'conv-1',
    });

    expect(result.classification.extracted.patient?.phone).toMatch(
      /^\{\{phone_\d+\}\}$/,
    );
    expect(result.classification.extracted.hospital).toBeUndefined();
    expect(result.classification.extracted.tuss).toBeUndefined();
    expect(result.classification.extracted.cid).toBeUndefined();
    expect(result.classification.extracted.opme).toBeUndefined();
  });

  it('propaga erro quando JSON inválido', async () => {
    openai.chatCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: 'isto não é json' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    } as any);

    await expect(
      service.classifyImage({
        imageBuffer: Buffer.from('img'),
        imageMimeType: 'image/jpeg',
        conversationId: 'conv-1',
      }),
    ).rejects.toThrow(/não é JSON válido/);
  });
});
