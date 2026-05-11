import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenaiService } from '../services/openai.service';
import {
  DocumentClassification,
  DocumentClassificationIntent,
  DocumentClassificationKind,
} from './document-classifier.types';

const SUPPORTED_KINDS: DocumentClassificationKind[] = [
  'surgery_request',
  'medical_report',
  'identity_document',
  'authorization_guide',
  'exam_report',
  'invoice',
  'receipt',
  'unknown',
];

const SUPPORTED_DOCUMENT_TYPES = [
  'personal_document',
  'exam_report',
  'medical_report',
  'authorization_guide',
  'invoice_protocol',
  'receipt_document',
  'contest_file',
  'additional_document',
];

const DOCUMENT_RESPONSE_SCHEMA = {
  name: 'DocumentClassification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: SUPPORTED_KINDS,
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      suggestedDocumentType: {
        type: 'string',
        enum: SUPPORTED_DOCUMENT_TYPES,
      },
      ambiguity: {
        type: ['string', 'null'],
      },
      extracted: {
        type: 'object',
        additionalProperties: false,
        properties: {
          patient: {
            type: ['object', 'null'],
            additionalProperties: false,
            properties: {
              name: { type: ['string', 'null'] },
              cpf: { type: ['string', 'null'] },
              birthDate: { type: ['string', 'null'] },
              rg: { type: ['string', 'null'] },
              motherName: { type: ['string', 'null'] },
              address: { type: ['string', 'null'] },
              phone: { type: ['string', 'null'] },
            },
            required: [
              'name',
              'cpf',
              'birthDate',
              'rg',
              'motherName',
              'address',
              'phone',
            ],
          },
          hospital: { type: ['string', 'null'] },
          healthPlan: {
            type: ['object', 'null'],
            additionalProperties: false,
            properties: {
              name: { type: ['string', 'null'] },
              planId: { type: ['string', 'null'] },
              validity: { type: ['string', 'null'] },
            },
            required: ['name', 'planId', 'validity'],
          },
          tuss: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['code', 'description'],
            },
          },
          cid: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string' },
              },
              required: ['code'],
            },
          },
          opme: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                description: { type: 'string' },
                qty: { type: 'number', minimum: 1 },
              },
              required: ['description', 'qty'],
            },
          },
          laudoText: { type: ['string', 'null'] },
          doctorCRM: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
        },
        required: [
          'patient',
          'hospital',
          'healthPlan',
          'tuss',
          'cid',
          'opme',
          'laudoText',
          'doctorCRM',
          'notes',
        ],
      },
    },
    required: [
      'kind',
      'confidence',
      'suggestedDocumentType',
      'ambiguity',
      'extracted',
    ],
  },
} as const;

const SYSTEM_PROMPT = [
  'Você é um classificador de documentos médicos brasileiros (laudos, guias',
  'de autorização, RG/CPF, exames, faturas, comprovantes). Sua tarefa é:',
  '',
  '1. Identificar o tipo do documento entre as categorias permitidas.',
  '2. Extrair APENAS os campos que estão claramente legíveis no texto.',
  '3. NÃO INVENTAR ou inferir dados que não estão escritos.',
  '4. Devolver placeholders no formato `{{categoria_n}}` exatamente como',
  '   recebidos — eles representam dados sensíveis do paciente que já foram',
  '   tokenizados pela camada de privacidade. NUNCA "expanda" um placeholder',
  '   nem invente um número/CPF/telefone real.',
  '5. Se a confiança for baixa (< 0.7), descrever a dúvida em `ambiguity`.',
  '6. Sempre devolver `null` (não string vazia) para campos ausentes.',
  '7. `qty` em OPME é inteiro positivo; se incerto, retorne `1`.',
  '',
  'Regras de mapeamento `kind` → `suggestedDocumentType`:',
  '- `medical_report` → `medical_report`',
  '- `exam_report` → `exam_report`',
  '- `identity_document` → `personal_document`',
  '- `authorization_guide` → `authorization_guide`',
  '- `invoice` → `invoice_protocol`',
  '- `receipt` → `receipt_document`',
  '- `surgery_request` → `medical_report`',
  '- `unknown` → `additional_document`',
].join('\n');

@Injectable()
export class DocumentClassifierService {
  private readonly logger = new Logger(DocumentClassifierService.name);

  constructor(
    private readonly openai: OpenaiService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Roda o classificador sobre o texto **JÁ TOKENIZADO** pelo PII Vault.
   * Devolve a estrutura `DocumentClassification` validada pelo `json_schema`
   * strict da OpenAI. Erros de parsing são propagados ao chamador (que pode
   * decidir cair no fallback Vision do Sprint 4).
   */
  async classify(opts: {
    text: string;
    intent?: DocumentClassificationIntent;
    messageSid?: string;
  }): Promise<DocumentClassification> {
    const result = await this.classifyWithUsage(opts);
    return result.classification;
  }

  /**
   * Variante que devolve também o `usage` da chamada OpenAI (prompt/completion
   * tokens, modelo, latência) para o chamador persistir em
   * `ai_token_usage_log` com stage `doc_classifier`. Não tem efeito colateral
   * adicional vs `classify()`.
   */
  async classifyWithUsage(opts: {
    text: string;
    intent?: DocumentClassificationIntent;
    messageSid?: string;
  }): Promise<{
    classification: DocumentClassification;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      model: string;
      latencyMs: number;
    };
  }> {
    const startedAt = Date.now();
    const trimmed = (opts.text || '').trim();
    if (!trimmed) {
      return {
        classification: this.buildEmptyClassification(startedAt, 'texto vazio'),
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          model: this.getModel(),
          latencyMs: Date.now() - startedAt,
        },
      };
    }

    const model = this.getModel();
    const userPrompt = this.buildUserPrompt(trimmed, opts.intent);

    const response = await this.openai.chatCompletion({
      model,
      temperature: 0,
      maxTokens: 800,
      timeoutMs: 30000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: {
        type: 'json_schema',
        json_schema: DOCUMENT_RESPONSE_SCHEMA as any,
      } as OpenAI.ChatCompletionCreateParams['response_format'],
    });

    const choice = response.choices?.[0];
    const rawContent =
      typeof choice?.message?.content === 'string'
        ? choice.message.content
        : '';
    const durationMs = Date.now() - startedAt;
    const usage = response.usage;

    let parsed: any;
    try {
      parsed = JSON.parse(rawContent);
    } catch (err: any) {
      this.logger.warn(
        `[AI_DOC_CLASSIFY] sid=${opts.messageSid ?? '-'} model=${model} parse_failed=${err?.message || 'erro'} content_len=${rawContent.length} prompt_tokens=${usage?.prompt_tokens ?? 0} completion_tokens=${usage?.completion_tokens ?? 0}`,
      );
      throw new Error(
        `Resposta do classificador não é JSON válido (model=${model}).`,
      );
    }

    const normalized = this.normalize(parsed, durationMs, model);
    this.logger.log(
      `[AI_DOC_CLASSIFY] sid=${opts.messageSid ?? '-'} model=${model} kind=${normalized.kind} confidence=${normalized.confidence.toFixed(2)} prompt_tokens=${usage?.prompt_tokens ?? 0} completion_tokens=${usage?.completion_tokens ?? 0} duration_ms=${normalized.durationMs}`,
    );

    return {
      classification: normalized,
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        model,
        latencyMs: durationMs,
      },
    };
  }

  private buildUserPrompt(
    text: string,
    intent?: DocumentClassificationIntent,
  ): string {
    const intentLine = intent
      ? `\nIntenção declarada pelo usuário: \`${intent}\` (use apenas como contexto, não force um \`kind\`).`
      : '';
    return [
      'Texto extraído do documento (já anonimizado por uma camada de PII Vault — placeholders `{{categoria_n}}` representam dados reais e DEVEM ser preservados):',
      '---',
      text,
      '---',
      intentLine,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private getModel(): string {
    const raw = this.configService.get<string>(
      'AI_DOC_CLASSIFIER_MODEL',
      'gpt-4o-mini',
    );
    return (raw && raw.trim()) || 'gpt-4o-mini';
  }

  private buildEmptyClassification(
    startedAt: number,
    reason: string,
  ): DocumentClassification {
    return {
      kind: 'unknown',
      confidence: 0,
      extracted: {},
      suggestedDocumentType: 'additional_document',
      ambiguity: reason,
      durationMs: Date.now() - startedAt,
      model: this.getModel(),
    };
  }

  /**
   * Normaliza a saída do LLM:
   * - garante que `kind` é um dos suportados (default `unknown`),
   * - clampa `confidence` em [0, 1],
   * - converte `null` → `undefined` nos campos opcionais (mais idiomático
   *   no consumidor TS),
   * - remove arrays vazios e objetos vazios para encolher logs/payloads.
   */
  private normalize(
    raw: any,
    durationMs: number,
    model: string,
  ): DocumentClassification {
    const kind: DocumentClassificationKind = SUPPORTED_KINDS.includes(raw?.kind)
      ? (raw.kind as DocumentClassificationKind)
      : 'unknown';

    const confidenceNumeric = Number(raw?.confidence);
    const confidence = Number.isFinite(confidenceNumeric)
      ? Math.max(0, Math.min(1, confidenceNumeric))
      : 0;

    const suggestedRaw =
      typeof raw?.suggestedDocumentType === 'string'
        ? raw.suggestedDocumentType
        : '';
    const suggestedDocumentType = SUPPORTED_DOCUMENT_TYPES.includes(
      suggestedRaw,
    )
      ? suggestedRaw
      : 'additional_document';

    const ambiguity =
      typeof raw?.ambiguity === 'string' && raw.ambiguity.trim()
        ? raw.ambiguity.trim()
        : undefined;

    const extracted = this.normalizeExtracted(raw?.extracted ?? {});

    return {
      kind,
      confidence,
      suggestedDocumentType,
      ambiguity,
      extracted,
      durationMs,
      model,
    };
  }

  private normalizeExtracted(raw: any): DocumentClassification['extracted'] {
    const out: DocumentClassification['extracted'] = {};

    const patient = this.coalesceObject(raw?.patient, [
      'name',
      'cpf',
      'birthDate',
      'rg',
      'motherName',
      'address',
      'phone',
    ]);
    if (patient) out.patient = patient;

    if (typeof raw?.hospital === 'string' && raw.hospital.trim()) {
      out.hospital = raw.hospital.trim();
    }

    const healthPlan = this.coalesceObject(raw?.healthPlan, [
      'name',
      'planId',
      'validity',
    ]);
    if (healthPlan) out.healthPlan = healthPlan;

    if (Array.isArray(raw?.tuss) && raw.tuss.length) {
      const tuss = raw.tuss
        .map((item: any) => ({
          code: typeof item?.code === 'string' ? item.code.trim() : '',
          description:
            typeof item?.description === 'string'
              ? item.description.trim()
              : '',
        }))
        .filter((item: any) => item.code);
      if (tuss.length) out.tuss = tuss;
    }

    if (Array.isArray(raw?.cid) && raw.cid.length) {
      const cid = raw.cid
        .map((item: any) => ({
          code: typeof item?.code === 'string' ? item.code.trim() : '',
        }))
        .filter((item: any) => item.code);
      if (cid.length) out.cid = cid;
    }

    if (Array.isArray(raw?.opme) && raw.opme.length) {
      const opme = raw.opme
        .map((item: any) => ({
          description:
            typeof item?.description === 'string'
              ? item.description.trim()
              : '',
          qty: Number.isFinite(Number(item?.qty))
            ? Math.max(1, Math.floor(Number(item?.qty)))
            : 1,
        }))
        .filter((item: any) => item.description);
      if (opme.length) out.opme = opme;
    }

    if (typeof raw?.laudoText === 'string' && raw.laudoText.trim()) {
      out.laudoText = raw.laudoText.trim();
    }

    if (typeof raw?.doctorCRM === 'string' && raw.doctorCRM.trim()) {
      out.doctorCRM = raw.doctorCRM.trim();
    }

    if (typeof raw?.notes === 'string' && raw.notes.trim()) {
      out.notes = raw.notes.trim();
    }

    return out;
  }

  private coalesceObject<T extends Record<string, any>>(
    raw: any,
    keys: string[],
  ): T | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const obj: any = {};
    let hasValue = false;
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'string' && value.trim()) {
        obj[key] = value.trim();
        hasValue = true;
      }
    }
    return hasValue ? (obj as T) : undefined;
  }
}
