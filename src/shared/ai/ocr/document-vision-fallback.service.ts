import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenaiService } from '../services/openai.service';
import { PiiVaultService } from '../services/pii-vault.service';
import {
  DocumentClassification,
  DocumentClassificationIntent,
} from './document-classifier.types';

const SUPPORTED_KINDS = [
  'surgery_request',
  'medical_report',
  'identity_document',
  'authorization_guide',
  'exam_report',
  'invoice',
  'receipt',
  'unknown',
] as const;

const SUPPORTED_DOCUMENT_TYPES = [
  'personal_document',
  'exam_report',
  'medical_report',
  'authorization_guide',
  'invoice_protocol',
  'receipt_document',
  'contest_file',
  'additional_document',
] as const;

/**
 * MIME types que conseguimos enviar para a API Vision do gpt-4o como
 * `data:` URL. PDFs precisam ser rasterizados antes (cabe ao chamador).
 */
const VISION_INPUT_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const DOCUMENT_RESPONSE_SCHEMA = {
  name: 'DocumentClassificationVision',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: SUPPORTED_KINDS as unknown as string[] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      suggestedDocumentType: {
        type: 'string',
        enum: SUPPORTED_DOCUMENT_TYPES as unknown as string[],
      },
      ambiguity: { type: ['string', 'null'] },
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
  'Você é um classificador VISUAL de documentos médicos brasileiros.',
  'Você vai receber UMA imagem (geralmente fotografada por celular) que pode ser:',
  '- Laudo médico, exame, RG/CPF, guia de autorização, fatura, comprovante.',
  '',
  'Sua tarefa:',
  '1. Identificar o tipo do documento entre as categorias permitidas.',
  '2. Extrair APENAS os campos visivelmente legíveis.',
  '3. NÃO INVENTAR dados — preferível devolver `null` a chutar.',
  '4. CPF, telefones e e-mails extraídos devem ser tokenizados depois pelo backend;',
  '   aqui devolva o valor cru exatamente como aparece na imagem.',
  '5. Se confiança < 0.7, descrever a dúvida em `ambiguity`.',
  '6. `qty` em OPME é inteiro positivo; se incerto, retorne `1`.',
  '',
  'Mapeamento `kind` → `suggestedDocumentType`:',
  '- `medical_report` → `medical_report`',
  '- `exam_report` → `exam_report`',
  '- `identity_document` → `personal_document`',
  '- `authorization_guide` → `authorization_guide`',
  '- `invoice` → `invoice_protocol`',
  '- `receipt` → `receipt_document`',
  '- `surgery_request` → `medical_report`',
  '- `unknown` → `additional_document`',
].join('\n');

export interface VisionFallbackInput {
  /** Buffer da imagem a enviar (apenas formatos `VISION_INPUT_MIMES`). */
  imageBuffer: Buffer;
  imageMimeType: string;
  intent?: DocumentClassificationIntent;
  conversationId: string;
  messageSid?: string;
}

export interface VisionFallbackUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  latencyMs: number;
}

export interface VisionFallbackResult {
  classification: DocumentClassification;
  usage: VisionFallbackUsage;
}

/**
 * Fallback para casos onde o pipeline texto-OCR falha:
 * - texto extraído é muito curto (< 30 chars),
 * - confiança média do Tesseract é baixa (< 0.5), ou
 * - o `DocumentClassifierService` lança erro/JSON inválido.
 *
 * Envia a imagem original direto ao `gpt-4o` (vision) com o mesmo JSON
 * Schema strict do classifier text-only. Após receber, **tokeniza CPF/
 * telefone/email** dos campos extraídos via `PiiVaultService` para que o
 * resto do pipeline trate o resultado igual ao do classifier text-only.
 */
@Injectable()
export class DocumentVisionFallbackService {
  private readonly logger = new Logger(DocumentVisionFallbackService.name);

  constructor(
    private readonly openai: OpenaiService,
    private readonly configService: ConfigService,
    private readonly piiVault: PiiVaultService,
  ) {}

  isEnabled(): boolean {
    const raw = this.configService.get<string>(
      'AI_DOC_VISION_FALLBACK_ENABLED',
      'true',
    );
    const normalized = String(raw).trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }

  isSupportedImageMime(mime: string): boolean {
    return VISION_INPUT_MIMES.has((mime || '').toLowerCase());
  }

  async classifyImage(
    input: VisionFallbackInput,
  ): Promise<VisionFallbackResult> {
    if (!this.isEnabled()) {
      throw new Error('Vision fallback está desabilitado.');
    }
    if (!this.isSupportedImageMime(input.imageMimeType)) {
      throw new Error(
        `MIME ${input.imageMimeType} não suportado pelo Vision fallback.`,
      );
    }

    const startedAt = Date.now();
    const model = this.getModel();

    const dataUrl = `data:${input.imageMimeType};base64,${input.imageBuffer.toString('base64')}`;
    const userContent: OpenAI.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: this.buildUserPrompt(input.intent),
      },
      {
        type: 'image_url',
        image_url: { url: dataUrl, detail: 'high' },
      } as any,
    ];

    const response = await this.openai.chatCompletion({
      model,
      temperature: 0,
      maxTokens: 800,
      timeoutMs: 45000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      responseFormat: {
        type: 'json_schema',
        json_schema: DOCUMENT_RESPONSE_SCHEMA as any,
      } as OpenAI.ChatCompletionCreateParams['response_format'],
    });

    const latencyMs = Date.now() - startedAt;
    const choice = response.choices?.[0];
    const rawContent =
      typeof choice?.message?.content === 'string'
        ? choice.message.content
        : '';

    let parsed: any;
    try {
      parsed = JSON.parse(rawContent);
    } catch (err: any) {
      this.logger.warn(
        `[AI_DOC_FALLBACK] sid=${input.messageSid ?? '-'} model=${model} parse_failed=${err?.message || 'erro'} content_len=${rawContent.length}`,
      );
      throw new Error(
        `Resposta do Vision fallback não é JSON válido (model=${model}).`,
      );
    }

    const usage = response.usage;
    const classification = this.normalizeAndTokenize(
      parsed,
      latencyMs,
      model,
      input.conversationId,
    );

    this.logger.log(
      `[AI_DOC_FALLBACK] sid=${input.messageSid ?? '-'} model=${model} kind=${classification.kind} confidence=${classification.confidence.toFixed(2)} prompt_tokens=${usage?.prompt_tokens ?? 0} completion_tokens=${usage?.completion_tokens ?? 0} latency_ms=${latencyMs}`,
    );

    return {
      classification,
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        model,
        latencyMs,
      },
    };
  }

  private buildUserPrompt(intent?: DocumentClassificationIntent): string {
    const intentLine = intent
      ? `Intenção declarada pelo usuário: \`${intent}\` (use apenas como contexto, não force um \`kind\`).`
      : '';
    return [
      'Analise a imagem do documento abaixo e devolva o JSON estruturado.',
      intentLine,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private getModel(): string {
    const raw = this.configService.get<string>(
      'AI_DOC_VISION_FALLBACK_MODEL',
      'gpt-4o',
    );
    return (raw && raw.trim()) || 'gpt-4o';
  }

  /**
   * Normaliza a saída do LLM Vision e tokeniza CPF/telefone/email dos
   * campos extraídos. Idempotente — o resultado fica equivalente ao do
   * classifier text-only (que já recebeu texto pré-tokenizado).
   */
  private normalizeAndTokenize(
    raw: any,
    latencyMs: number,
    model: string,
    conversationId: string,
  ): DocumentClassification {
    const kind = (SUPPORTED_KINDS as readonly string[]).includes(raw?.kind)
      ? raw.kind
      : 'unknown';
    const confidenceNumeric = Number(raw?.confidence);
    const confidence = Number.isFinite(confidenceNumeric)
      ? Math.max(0, Math.min(1, confidenceNumeric))
      : 0;

    const suggestedRaw =
      typeof raw?.suggestedDocumentType === 'string'
        ? raw.suggestedDocumentType
        : '';
    const suggestedDocumentType = (
      SUPPORTED_DOCUMENT_TYPES as readonly string[]
    ).includes(suggestedRaw)
      ? suggestedRaw
      : 'additional_document';

    const ambiguity =
      typeof raw?.ambiguity === 'string' && raw.ambiguity.trim()
        ? raw.ambiguity.trim()
        : undefined;

    const extracted = this.normalizeExtracted(
      raw?.extracted ?? {},
      conversationId,
    );

    return {
      kind: kind as DocumentClassification['kind'],
      confidence,
      suggestedDocumentType,
      ambiguity,
      extracted,
      durationMs: latencyMs,
      model,
    };
  }

  private normalizeExtracted(
    raw: any,
    conversationId: string,
  ): DocumentClassification['extracted'] {
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
    if (patient) {
      const tokenized: any = { ...patient };
      if (tokenized.cpf) {
        tokenized.cpf = this.piiVault.preprocessUserInput(
          conversationId,
          tokenized.cpf,
        );
      }
      if (tokenized.phone) {
        tokenized.phone = this.piiVault.preprocessUserInput(
          conversationId,
          tokenized.phone,
        );
      }
      out.patient = tokenized;
    }

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
