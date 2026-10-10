import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenaiService } from '../services/openai.service';
import { PiiVaultService } from '../services/pii-vault.service';
import {
  DocumentClassification,
  DocumentClassificationIntent,
} from './document-classifier.types';
import {
  DOCUMENT_VISION_RESPONSE_SCHEMA,
  DOCUMENT_VISION_SYSTEM_PROMPT,
  VISION_SUPPORTED_DOCUMENT_TYPES,
  VISION_SUPPORTED_KINDS,
} from '../prompts/document-vision.prompt';
import {
  asRecord,
  coalesceStringFields,
  optionalTrimmed,
  parseCidItems,
  parseConfidence,
  parseKind,
  parseOpmeItems,
  parseStringItems,
  parseSuggestedDocumentType,
  parseTussItems,
  RawRecord,
} from './classification-parsing';

const VISION_INPUT_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export interface VisionFallbackInput {
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
    const visionDetail = this.getVisionDetail();
    const userContent: OpenAI.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: this.buildUserPrompt(input.intent),
      },
      {
        type: 'image_url',
        image_url: { url: dataUrl, detail: visionDetail },
      },
    ];

    const response = await this.openai.chatCompletion({
      model,
      temperature: 0,
      maxTokens: this.getMaxTokens(),
      timeoutMs: 45000,
      messages: [
        { role: 'system', content: DOCUMENT_VISION_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      responseFormat: {
        type: 'json_schema',
        json_schema: DOCUMENT_VISION_RESPONSE_SCHEMA,
      } as OpenAI.ChatCompletionCreateParams['response_format'],
      stage: 'doc_vision_fallback',
    });

    const latencyMs = Date.now() - startedAt;
    const choice = response.choices?.[0];
    const rawContent =
      typeof choice?.message?.content === 'string'
        ? choice.message.content
        : '';

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (err: unknown) {
      this.logger.warn(
        `[AI_DOC_FALLBACK] sid=${input.messageSid ?? '-'} model=${model} parse_failed=${(err as Error)?.message || 'erro'} content_len=${rawContent.length}`,
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

  private getMaxTokens(): number {
    const raw = this.configService.get<string>(
      'AI_DOC_VISION_FALLBACK_MAX_TOKENS',
      '2500',
    );
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 2500;
    return Math.max(600, Math.min(4000, Math.floor(parsed)));
  }

  private getVisionDetail(): 'auto' | 'low' | 'high' {
    const raw = this.configService.get<string>('AI_DOC_VISION_DETAIL', 'auto');
    const normalized = (raw || 'auto').trim().toLowerCase();
    if (normalized === 'high' || normalized === 'low') {
      return normalized;
    }
    return 'auto';
  }

  private normalizeAndTokenize(
    rawValue: unknown,
    latencyMs: number,
    model: string,
    conversationId: string,
  ): DocumentClassification {
    const raw = asRecord(rawValue);
    return {
      kind: parseKind(raw.kind, VISION_SUPPORTED_KINDS),
      confidence: parseConfidence(raw.confidence),
      suggestedDocumentType: parseSuggestedDocumentType(
        raw.suggestedDocumentType,
        VISION_SUPPORTED_DOCUMENT_TYPES,
      ),
      ambiguity: optionalTrimmed(raw.ambiguity),
      extracted: this.normalizeExtracted(
        asRecord(raw.extracted),
        conversationId,
      ),
      durationMs: latencyMs,
      model,
    };
  }

  private normalizeExtracted(
    raw: RawRecord,
    conversationId: string,
  ): DocumentClassification['extracted'] {
    const out: DocumentClassification['extracted'] = {};

    const patient = coalesceStringFields(raw.patient, [
      'name',
      'cpf',
      'birthDate',
      'rg',
      'motherName',
      'address',
      'phone',
    ]);
    if (patient) {
      const tokenized = { ...patient };
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

    const hospital = optionalTrimmed(raw.hospital);
    if (hospital) out.hospital = hospital;

    const healthPlan = coalesceStringFields(raw.healthPlan, [
      'name',
      'planId',
      'validity',
    ]);
    if (healthPlan) out.healthPlan = healthPlan;

    const tuss = parseTussItems(raw.tuss, { withQty: false });
    if (tuss.length) out.tuss = tuss;

    const cid = parseCidItems(raw.cid);
    if (cid.length) out.cid = cid;

    const opme = parseOpmeItems(raw.opme);
    if (opme.length) out.opme = opme;

    const suppliers = parseStringItems(raw.suggestedSuppliers);
    if (suppliers.length) out.suggestedSuppliers = suppliers;

    const diagnosis = optionalTrimmed(raw.diagnosis);
    if (diagnosis) out.diagnosis = diagnosis;

    const suggestedProcedureName = optionalTrimmed(raw.suggestedProcedureName);
    if (suggestedProcedureName) {
      out.suggestedProcedureName = suggestedProcedureName;
    }

    const laudoText = optionalTrimmed(raw.laudoText);
    if (laudoText) out.laudoText = laudoText;

    const notes = optionalTrimmed(raw.notes);
    if (notes) out.notes = notes;

    return out;
  }
}
