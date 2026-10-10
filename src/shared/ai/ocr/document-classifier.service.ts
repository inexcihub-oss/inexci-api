import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenaiService } from '../services/openai.service';
import {
  DocumentClassification,
  DocumentClassificationIntent,
} from './document-classifier.types';
import {
  CLASSIFIER_SUPPORTED_DOCUMENT_TYPES,
  CLASSIFIER_SUPPORTED_KINDS,
  DOCUMENT_CLASSIFIER_RESPONSE_SCHEMA,
  DOCUMENT_CLASSIFIER_SYSTEM_PROMPT,
} from '../prompts/document-classifier.prompt';
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
  trimmedString,
} from './classification-parsing';

const ADMIN_REPORT_SECTION_TITLE_PATTERNS: RegExp[] = [
  /\bidentifica(?:cao|ção)\b.*\bobjetivo\b/,
  /\bidentifica(?:cao|ção)\b.*\brelat(?:orio|ório)\b/,
  /\bdados\b.*\bpaciente\b/,
  /\bdados\b.*\bcadastrais\b/,
  /\bqualifica(?:cao|ção)\b.*\bpaciente\b/,
  /\bobjetivo\b.*\brelat(?:orio|ório)\b/,
  /\bc(?:ó|o)digos?\b.*\bsolicitados?\b/,
  /\btuss\b/,
  /\bcbhpm\b/,
  /\bopme\b/,
  /\bmateriais?\b.*\bsolicitados?\b/,
  /\bfornecedores?\b/,
];

const ADMIN_REPORT_SECTION_DESCRIPTION_MARKERS = [
  'cpf',
  'rg',
  'endereco',
  'endereço',
  'cep',
  'carteirinha',
  'convenio',
  'convênio',
  'plano',
  'telefone',
  'tel.',
  'dn',
  'data de nascimento',
  'id:',
  'paciente:',
];

const CLINICAL_REPORT_SECTION_DESCRIPTION_MARKERS = [
  'diagnostico',
  'diagnóstico',
  'queixa',
  'dor',
  'exame',
  'rnm',
  'ressonancia',
  'ressonância',
  'tomografia',
  'conduta',
  'indicacao cirurgica',
  'indicação cirúrgica',
  'hernia',
  'hérnia',
  'radiculopatia',
  'compressao',
  'compressão',
];

@Injectable()
export class DocumentClassifierService {
  private readonly logger = new Logger(DocumentClassifierService.name);

  constructor(
    private readonly openai: OpenaiService,
    private readonly configService: ConfigService,
  ) {}

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
    const maxTokens = this.getMaxTokens();
    const classifierText = this.truncateForClassifier(trimmed);
    const userPrompt = this.buildUserPrompt(classifierText, opts.intent);

    if (this.isBlobPlaceholderOnly(trimmed)) {
      this.logger.warn(
        `[AI_DOC_CLASSIFY] sid=${opts.messageSid ?? '-'} model=${model} blob_only_input=true input_len=${trimmed.length}`,
      );
      return {
        classification: this.buildEmptyClassification(
          startedAt,
          'texto degenerou em payload_blob — desabilite o blobThreshold no caminho OCR',
        ),
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          model,
          latencyMs: Date.now() - startedAt,
        },
      };
    }

    const response = await this.openai.chatCompletion({
      model,
      temperature: 0,
      maxTokens,
      timeoutMs: this.getTimeoutMs(),
      messages: [
        { role: 'system', content: DOCUMENT_CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: {
        type: 'json_schema',
        json_schema: DOCUMENT_CLASSIFIER_RESPONSE_SCHEMA,
      },
      stage: 'doc_classifier',
    });

    const choice = response.choices?.[0];
    const rawContent =
      typeof choice?.message?.content === 'string'
        ? choice.message.content
        : '';
    const durationMs = Date.now() - startedAt;
    const usage = response.usage;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (err: unknown) {
      this.logger.warn(
        `[AI_DOC_CLASSIFY] sid=${opts.messageSid ?? '-'} model=${model} parse_failed=${(err as Error)?.message || 'erro'} content_len=${rawContent.length} prompt_tokens=${usage?.prompt_tokens ?? 0} completion_tokens=${usage?.completion_tokens ?? 0}`,
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
      'gpt-5.4-nano',
    );
    return (raw && raw.trim()) || 'gpt-5.4-nano';
  }

  private getMaxTokens(): number {
    const raw = this.configService.get<string>(
      'AI_DOC_CLASSIFIER_MAX_TOKENS',
      '4000',
    );
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 4000;
    return Math.max(600, Math.min(6000, Math.floor(parsed)));
  }

  private getTimeoutMs(): number {
    const raw = this.configService.get<string>(
      'AI_DOC_CLASSIFIER_TIMEOUT_MS',
      '60000',
    );
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 60000;
    return Math.max(5000, Math.min(120000, Math.floor(parsed)));
  }

  private truncateForClassifier(text: string): string {
    const maxChars = this.getMaxInputChars();
    if (text.length <= maxChars) return text;

    const pageAware = this.truncateByPageMarkers(text, maxChars);
    if (pageAware) {
      this.logger.log(
        `[AI_DOC_CLASSIFY] input_truncated original_len=${text.length} strategy=page_aware truncated_len=${pageAware.length}`,
      );
      return pageAware;
    }

    const headChars = Math.min(10000, Math.floor(maxChars * 0.55));
    const tailChars = Math.max(8000, maxChars - headChars - 40);
    const head = text.slice(0, headChars);
    const tail = text.slice(-tailChars);

    this.logger.log(
      `[AI_DOC_CLASSIFY] input_truncated original_len=${text.length} strategy=head_tail head=${headChars} tail=${tailChars}`,
    );

    return `${head}\n\n[...trecho intermediário omitido para performance...]\n\n${tail}`;
  }

  private truncateByPageMarkers(text: string, maxChars: number): string | null {
    const chunks = text
      .split(/\n\n(?=\[PÁGINA \d+\]\n)/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    if (chunks.length <= 1) return null;

    const firstPage = chunks[0];
    const tailPageCount = Math.min(3, Math.max(1, chunks.length - 1));
    const tailPages = chunks.slice(-tailPageCount);
    const middlePages = chunks.slice(1, chunks.length - tailPageCount);

    const selected: string[] = [];
    const pushIfFits = (chunk: string) => {
      const candidate = [...selected, chunk].join('\n\n');
      if (candidate.length <= maxChars) {
        selected.push(chunk);
        return true;
      }
      return false;
    };

    if (firstPage) selected.push(firstPage);
    for (const page of middlePages) {
      pushIfFits(page);
    }
    for (const page of tailPages) {
      if (!selected.includes(page)) pushIfFits(page);
    }

    let consolidated = selected.join('\n\n');
    if (consolidated.length <= maxChars) return consolidated;

    const compactTail = tailPages.join('\n\n');
    const compactHeadBudget = Math.max(
      2000,
      maxChars - compactTail.length - 40,
    );
    const compactHead = firstPage.slice(0, compactHeadBudget);
    consolidated = `${compactHead}\n\n[...páginas intermediárias omitidas...]\n\n${compactTail}`;
    return consolidated.slice(0, maxChars);
  }

  private getMaxInputChars(): number {
    const raw = this.configService.get<string>(
      'AI_DOC_CLASSIFIER_MAX_INPUT_CHARS',
      '22000',
    );
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 22000;
    return Math.max(4000, Math.min(50000, Math.floor(parsed)));
  }

  private isBlobPlaceholderOnly(text: string): boolean {
    const blobMatches = text.match(/\{\{payload_blob_\d+\}\}/g) ?? [];
    if (blobMatches.length !== 1) return false;
    const stripped = text.replace(/\{\{payload_blob_\d+\}\}/g, '').trim();
    return stripped.length < 60;
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

  private normalize(
    rawValue: unknown,
    durationMs: number,
    model: string,
  ): DocumentClassification {
    const raw = asRecord(rawValue);
    return {
      kind: parseKind(raw.kind, CLASSIFIER_SUPPORTED_KINDS),
      confidence: parseConfidence(raw.confidence),
      suggestedDocumentType: parseSuggestedDocumentType(
        raw.suggestedDocumentType,
        CLASSIFIER_SUPPORTED_DOCUMENT_TYPES,
      ),
      ambiguity: optionalTrimmed(raw.ambiguity),
      extracted: this.normalizeExtracted(asRecord(raw.extracted)),
      durationMs,
      model,
    };
  }

  private normalizeExtracted(
    raw: RawRecord,
  ): DocumentClassification['extracted'] {
    const out: DocumentClassification['extracted'] = {};

    const patient = coalesceStringFields(raw.patient, [
      'name',
      'cpf',
      'birthDate',
      'rg',
      'motherName',
      'address',
      'addressNumber',
      'addressComplement',
      'neighborhood',
      'city',
      'state',
      'zipCode',
      'phone',
    ]);
    if (patient) out.patient = patient;

    const hospital = optionalTrimmed(raw.hospital);
    if (hospital) out.hospital = hospital;

    const healthPlan = coalesceStringFields(raw.healthPlan, [
      'name',
      'planId',
      'validity',
    ]);
    if (healthPlan) out.healthPlan = healthPlan;

    const tuss = parseTussItems(raw.tuss, { withQty: true });
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

    const sections = (
      Array.isArray(raw.reportSections) ? raw.reportSections : []
    )
      .map((value) => {
        const item = asRecord(value);
        return {
          title: trimmedString(item.title),
          description: trimmedString(item.description),
        };
      })
      .filter(
        (item) =>
          item.title &&
          item.description &&
          !this.isAdministrativeReportSection(item.title, item.description),
      );
    if (sections.length) out.reportSections = sections;

    const laudoText = optionalTrimmed(raw.laudoText);
    if (laudoText) out.laudoText = laudoText;

    const notes = optionalTrimmed(raw.notes);
    if (notes) out.notes = notes;

    return out;
  }

  private isAdministrativeReportSection(
    title: string,
    description: string,
  ): boolean {
    const normalizedTitle = this.normalizeForSectionFilter(title);
    const normalizedDescription = this.normalizeForSectionFilter(description);

    if (
      ADMIN_REPORT_SECTION_TITLE_PATTERNS.some((pattern) =>
        pattern.test(normalizedTitle),
      )
    ) {
      return true;
    }

    const adminHits = ADMIN_REPORT_SECTION_DESCRIPTION_MARKERS.filter(
      (marker) => normalizedDescription.includes(marker),
    ).length;
    const clinicalHits = CLINICAL_REPORT_SECTION_DESCRIPTION_MARKERS.filter(
      (marker) => normalizedDescription.includes(marker),
    ).length;

    return adminHits >= 2 && clinicalHits === 0;
  }

  private normalizeForSectionFilter(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
