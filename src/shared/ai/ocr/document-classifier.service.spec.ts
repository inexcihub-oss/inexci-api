import { ConfigService } from '@nestjs/config';
import { OpenaiService } from '../services/openai.service';
import { DocumentClassifierService } from './document-classifier.service';

describe('DocumentClassifierService', () => {
  let openai: jest.Mocked<OpenaiService>;
  let configService: ConfigService;
  let service: DocumentClassifierService;

  beforeEach(() => {
    openai = {
      chatCompletion: jest.fn(),
    } as any;

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'AI_DOC_CLASSIFIER_MODEL') return 'gpt-4o-mini';
        return defaultValue;
      }),
    } as any;

    service = new DocumentClassifierService(openai, configService);
  });

  function buildLlmResponse(payload: object) {
    return {
      choices: [
        {
          message: { content: JSON.stringify(payload) },
        },
      ],
    } as any;
  }

  it('devolve classificação vazia quando texto está em branco', async () => {
    const result = await service.classify({ text: '   ' });

    expect(openai.chatCompletion).not.toHaveBeenCalled();
    expect(result.kind).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.suggestedDocumentType).toBe('additional_document');
    expect(result.ambiguity).toBe('texto vazio');
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('chama o LLM com response_format json_schema strict e modelo configurado', async () => {
    openai.chatCompletion.mockResolvedValueOnce(
      buildLlmResponse({
        kind: 'medical_report',
        confidence: 0.92,
        suggestedDocumentType: 'medical_report',
        ambiguity: null,
        extracted: {
          patient: {
            name: 'JOAO SILVA',
            cpf: '{{cpf_1}}',
            birthDate: null,
            rg: null,
            motherName: null,
            address: null,
            phone: null,
          },
          hospital: 'Hospital São Lucas',
          healthPlan: { name: null, planId: null, validity: null },
          tuss: null,
          cid: null,
          opme: null,
          laudoText: 'Paciente com lesão de menisco medial direito.',
          notes: null,
        },
      }),
    );

    const result = await service.classify({
      text: 'Laudo médico completo com {{cpf_1}}.',
      intent: 'attach',
      messageSid: 'SM-test',
    });

    expect(openai.chatCompletion).toHaveBeenCalledTimes(1);
    const callArgs = openai.chatCompletion.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o-mini');
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.responseFormat).toEqual(
      expect.objectContaining({ type: 'json_schema' }),
    );
    expect((callArgs.responseFormat as any).json_schema?.strict).toBe(true);
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[1].role).toBe('user');
    expect(callArgs.messages[1].content).toContain('{{cpf_1}}');
    expect(callArgs.messages[1].content).toContain('attach');

    expect(result.kind).toBe('medical_report');
    expect(result.suggestedDocumentType).toBe('medical_report');
    expect(result.confidence).toBeCloseTo(0.92, 2);
    expect(result.ambiguity).toBeUndefined();
    expect(result.extracted.patient).toEqual({
      name: 'JOAO SILVA',
      cpf: '{{cpf_1}}',
    });
    expect(result.extracted.hospital).toBe('Hospital São Lucas');
    expect(result.extracted.laudoText).toContain('menisco');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('clampa confidence inválido e usa defaults seguros para enums', async () => {
    openai.chatCompletion.mockResolvedValueOnce(
      buildLlmResponse({
        kind: 'plot_twist',
        confidence: 5,
        suggestedDocumentType: 'inexistente',
        ambiguity: '   ',
        extracted: {
          patient: null,
          hospital: '',
          healthPlan: null,
          tuss: [],
          cid: [],
          opme: [],
          laudoText: null,
          notes: null,
        },
      }),
    );

    const result = await service.classify({
      text: 'documento confuso',
    });

    expect(result.kind).toBe('unknown');
    expect(result.confidence).toBe(1);
    expect(result.suggestedDocumentType).toBe('additional_document');
    expect(result.ambiguity).toBeUndefined();
    expect(result.extracted).toEqual({});
  });

  it('normaliza arrays de TUSS/CID/OPME removendo entradas inválidas', async () => {
    openai.chatCompletion.mockResolvedValueOnce(
      buildLlmResponse({
        kind: 'authorization_guide',
        confidence: 0.8,
        suggestedDocumentType: 'authorization_guide',
        ambiguity: null,
        extracted: {
          patient: null,
          hospital: null,
          healthPlan: { name: 'Unimed', planId: null, validity: null },
          tuss: [
            { code: '30602122', description: 'Artroscopia de joelho' },
            { code: '', description: 'sem código' },
          ],
          cid: [{ code: 'M23.2' }, { code: '   ' }],
          opme: [
            { description: 'Âncora 5mm', qty: 2, supplier: null, manufacturer: null },
            { description: '', qty: 3, supplier: null, manufacturer: null },
            {
              description: 'Parafuso interferência',
              qty: 'um' as any,
              supplier: null,
              manufacturer: null,
            },
          ],
          suggestedSuppliers: null,
          diagnosis: null,
          suggestedProcedureName: null,
          laudoText: null,
          notes: null,
        },
      }),
    );

    const result = await service.classify({ text: 'guia válida' });

    expect(result.extracted.tuss).toEqual([
      { code: '30602122', description: 'Artroscopia de joelho' },
    ]);
    expect(result.extracted.cid).toEqual([{ code: 'M23.2' }]);
    expect(result.extracted.opme).toEqual([
      { description: 'Âncora 5mm', qty: 2 },
      { description: 'Parafuso interferência', qty: 1 },
    ]);
    expect(result.extracted.healthPlan).toEqual({ name: 'Unimed' });
  });

  it('extrai diagnóstico, procedimento sugerido, OPME com supplier/manufacturer e fornecedores', async () => {
    // Caso real do laudo do Jean Pierre — o classifier deve devolver TUDO
    // que aparece estruturado no documento.
    openai.chatCompletion.mockResolvedValueOnce(
      buildLlmResponse({
        kind: 'surgery_request',
        confidence: 0.95,
        suggestedDocumentType: 'medical_report',
        ambiguity: null,
        extracted: {
          patient: {
            name: 'Jean Pierre Pereira Proximo',
            cpf: null,
            birthDate: null,
            rg: null,
            motherName: null,
            address: null,
            phone: null,
          },
          hospital: null,
          healthPlan: {
            name: 'Bradesco',
            planId: null,
            validity: null,
          },
          tuss: [
            {
              code: '3.07.15.091',
              description: 'Descompressão medular e/ou cauda equina',
            },
            {
              code: '3.07.15.024',
              description: 'Artrodese de coluna via anterior C5-C6',
            },
          ],
          cid: null,
          opme: [
            {
              description: 'CAGES STAND ALONE',
              qty: 2,
              supplier: 'SINTEX',
              manufacturer: 'DIVA/NOVA SPINE',
            },
            {
              description: 'ANCORAS',
              qty: 4,
              supplier: null,
              manufacturer: null,
            },
          ],
          suggestedSuppliers: ['SINTEX', 'VITALITY', 'GUSMED'],
          diagnosis:
            'Hérnia discal cervical médio-foraminal C5-C6 e C4-C5 com compressão radicular e medular',
          suggestedProcedureName: 'Artrodese cervical anterior C5-C6 e C4-C5',
          laudoText:
            'Paciente com queixa de dor radicular braquial à esquerda incapacitante. RNM cervical com Hérnia discal cervical médio-foraminal C5-C6 e C4-C5 com compressão radicular e medular. Indicado procedimento cirúrgico com artrodese cervical.',
          notes: null,
        },
      }),
    );

    const result = await service.classify({
      text: 'laudo do jean pierre — texto completo com mais de 60 chars',
      intent: 'create_sc',
    });

    expect(result.kind).toBe('surgery_request');
    expect(result.extracted.diagnosis).toContain('Hérnia discal cervical');
    expect(result.extracted.suggestedProcedureName).toBe(
      'Artrodese cervical anterior C5-C6 e C4-C5',
    );
    expect(result.extracted.suggestedSuppliers).toEqual([
      'SINTEX',
      'VITALITY',
      'GUSMED',
    ]);
    expect(result.extracted.opme).toEqual([
      {
        description: 'CAGES STAND ALONE',
        qty: 2,
        supplier: 'SINTEX',
        manufacturer: 'DIVA/NOVA SPINE',
      },
      { description: 'ANCORAS', qty: 4 },
    ]);
    expect(result.extracted.tuss).toHaveLength(2);
    expect(result.extracted.laudoText).toContain('RNM cervical');
  });

  it('propaga erro quando o LLM devolve JSON inválido', async () => {
    openai.chatCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: 'isto não é json' } }],
    } as any);

    await expect(service.classify({ text: 'algum texto' })).rejects.toThrow(
      /Resposta do classificador não é JSON válido/,
    );
  });

  it('curto-circuita quando o input degenerou em payload_blob (proteção contra regressão do PII Vault)', async () => {
    const result = await service.classify({
      text: '   {{payload_blob_3}}   ',
    });

    // Não chegou a chamar a OpenAI — economiza tokens.
    expect(openai.chatCompletion).not.toHaveBeenCalled();
    expect(result.kind).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.ambiguity).toContain('payload_blob');
  });

  it('usa maxTokens 2500 (cobre laudos com TUSS/CID/OPME completos)', async () => {
    openai.chatCompletion.mockResolvedValueOnce(
      buildLlmResponse({
        kind: 'medical_report',
        confidence: 0.9,
        suggestedDocumentType: 'medical_report',
        ambiguity: null,
        extracted: {
          patient: {
            name: null,
            cpf: null,
            birthDate: null,
            rg: null,
            motherName: null,
            address: null,
            phone: null,
          },
          hospital: null,
          healthPlan: null,
          tuss: null,
          cid: null,
          opme: null,
          laudoText: null,
          notes: null,
        },
      }),
    );

    await service.classify({
      text: 'Texto qualquer com mais de 60 chars para evitar curto-circuito de blob.',
    });
    const callArgs = openai.chatCompletion.mock.calls[0][0];
    expect(callArgs.maxTokens).toBe(2500);
  });
});
