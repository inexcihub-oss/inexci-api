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
              addressNumber: { type: ['string', 'null'] },
              addressComplement: { type: ['string', 'null'] },
              neighborhood: { type: ['string', 'null'] },
              city: { type: ['string', 'null'] },
              state: { type: ['string', 'null'] },
              zipCode: { type: ['string', 'null'] },
              phone: { type: ['string', 'null'] },
            },
            required: [
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
                qty: { type: ['number', 'null'], minimum: 1 },
              },
              required: ['code', 'description', 'qty'],
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
                supplier: { type: ['string', 'null'] },
                manufacturer: { type: ['string', 'null'] },
              },
              required: ['description', 'qty', 'supplier', 'manufacturer'],
            },
          },
          suggestedSuppliers: {
            type: ['array', 'null'],
            items: { type: 'string' },
          },
          diagnosis: { type: ['string', 'null'] },
          suggestedProcedureName: { type: ['string', 'null'] },
          reportSections: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['title', 'description'],
            },
          },
          laudoText: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
        },
        required: [
          'patient',
          'hospital',
          'healthPlan',
          'tuss',
          'cid',
          'opme',
          'suggestedSuppliers',
          'diagnosis',
          'suggestedProcedureName',
          'reportSections',
          'laudoText',
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
  'de autorização, RG/CPF, exames, faturas, comprovantes). Seu papel é EXTRAIR',
  'O MÁXIMO POSSÍVEL de informação útil para preencher uma solicitação',
  'cirúrgica — quanto mais campos completos, menos perguntas o sistema fará',
  'ao médico depois.',
  '',
  'REGRAS GERAIS:',
  '1. Identifique o `kind` do documento entre as categorias permitidas.',
  '2. Extraia TODO campo que estiver claramente legível. Se está escrito,',
  '   coloque na resposta — não seja conservador.',
  '3. NÃO invente: se não está no texto, retorne `null`.',
  '4. CPF, RG, telefone, e-mail e endereço podem estar tokenizados no texto',
  '   como placeholders (exemplos: `{{cpf_1}}`, `{{rg_1}}`, `{{phone_1}}`,',
  '   `{{email_1}}`). Copie esses tokens EXATAMENTE como aparecem no texto —',
  '   não os expanda nem interprete. NOMES de pessoas nunca são tokenizados:',
  '   extraia-os literalmente.',
  '5. Se confiança < 0.75, descreva a dúvida em `ambiguity`.',
  '6. Sempre `null` (não string vazia) para ausentes.',
  '',
  'COMO LER UM LAUDO/SOLICITAÇÃO CIRÚRGICA TÍPICO BRASILEIRO:',
  '',
  'Cabeçalho — geralmente tem o nome da clínica e os médicos. NÃO precisa',
  'extrair CRM (o sistema já sabe quem é o médico solicitante).',
  '',
  '"Paciente: <NOME>" → `extracted.patient.name`. Pode aparecer também como',
  '"Pcte:", "Nome:", "Nome do paciente:". É comum o cabeçalho trazer várias',
  'linhas seguidas sem rótulo explícito, ex.:',
  '  "Lucas Bruno Borges de Medeiros',
  '   DN 26/10/1995 / ID: 27.903.040-7 DETRAN-RJ / CPF 168.508.057-03',
  '   END: Rua Guarajanga, Q 6 01, Lt 13 Duque de Caxias - RJ. CEP 25.220-290 / Tel. 21 97744-0411',
  '   SULAMERICA 88888 0167 4659 0018"',
  'Nesse padrão: 1ª linha = `patient.name`; "DN" = `patient.birthDate`;',
  '"ID:" = `patient.rg`; "CPF" = `patient.cpf`; "Tel."/"Cel." =',
  '`patient.phone`; a linha com nome de',
  'operadora (SULAMERICA, BRADESCO SAÚDE, AMIL, UNIMED etc.) seguida de uma',
  'sequência numérica longa = `healthPlan.name` (a operadora) +',
  '`healthPlan.planId` (o número da carteirinha), mesmo sem rótulo',
  '"Convênio:"/"Plano:"/"Carteirinha:".',
  '"Plano: <NOME>" / "Convênio: <NOME>" → `extracted.healthPlan.name`.',
  '"N° Carteirinha:" / "Carteirinha:" / "Matrícula:" → `extracted.healthPlan.planId`.',
  '',
  'ENDEREÇO DO PACIENTE ("END:", "Endereço:", "Resid.:" etc.):',
  'Quebre o endereço em componentes em vez de copiar o texto inteiro para',
  '`patient.address`. Campos: `patient.address` (logradouro — rua/avenida/',
  'travessa, sem número), `patient.addressNumber` (número do imóvel — só',
  'dígitos, ex.: "123"), `patient.addressComplement` (qualquer informação',
  'extra de localização que não seja logradouro/número/bairro/cidade/UF —',
  'quadra, lote, bloco, apto, casa, ponto de referência etc.),',
  '`patient.neighborhood` (bairro), `patient.city` (cidade), `patient.state`',
  '(UF, 2 letras maiúsculas) e `patient.zipCode` (CEP). IMPORTANTE: marcadores',
  'como "Q"/"Quadra", "Lt"/"Lote", "Bl"/"Bloco", "Apto", "Casa" SEMPRE viram',
  '`addressComplement` quando aparecem no texto — nunca descarte essa',
  'informação só porque não há um número de casa tradicional separado.',
  'Exemplo: "END: Rua Guarajanga, Q 6 01, Lt 13 Duque de Caxias - RJ. CEP',
  '25.220-290" → address="Rua Guarajanga", addressNumber=null,',
  'addressComplement="Q 6 01, Lt 13", city="Duque de Caxias", state="RJ",',
  'zipCode="25.220-290" (addressNumber fica `null` pois não há um número de',
  'casa isolado, mas addressComplement é OBRIGATORIAMENTE preenchido com a',
  'informação de quadra/lote que está no texto). Outro exemplo: "Av. Brasil,',
  '450, Bloco 2 Apto 301, Centro, Rio de Janeiro - RJ" → addressNumber="450",',
  'addressComplement="Bloco 2 Apto 301", neighborhood="Centro",',
  'city="Rio de Janeiro", state="RJ". Só deixe um componente `null` quando',
  'ele REALMENTE não aparece no texto — nunca invente bairro, número ou',
  'cidade que não estejam escritos.',
  '',
  'LOCAL DA CIRURGIA (hospital):',
  'Não procure apenas o rótulo "Hospital:" / "Clínica:". Para cada documento,',
  'pergunte-se: "este texto diz ONDE a cirurgia será realizada? Se sim, qual',
  'é o nome desse hospital/clínica?". A informação pode estar em qualquer',
  'lugar do texto e fraseada de formas muito diferentes — não existe um',
  'único padrão fixo. Exemplos de frases que respondem "sim" a essa',
  'pergunta (NÃO é uma lista exaustiva, apenas ilustrações do tipo de',
  'raciocínio esperado):',
  '  - Rótulo direto: "Hospital: <NOME>", "Clínica: <NOME>", "Unidade:',
  '    <NOME>".',
  '  - Frase de fechamento com data, ex.: "Local: Será realizada no Hospital',
  '    Caxias D\'Or, na data de 14/10/2023." → aqui `extracted.hospital =',
  '    "Hospital Caxias D\'Or"` (ignore a data — não há campo para isso).',
  '  - Frase corrida sem rótulo, ex.: "Cirurgia agendada para o Hospital São',
  '    Lucas", "Procedimento será realizado no Hospital e Maternidade Santa',
  '    Joana", "Internação prevista na Clínica NeuroVida".',
  '  - Menção dentro de outro contexto, ex.: "Solicito autorização para',
  '    realização no Hospital Albert Einstein" ou um cabeçalho/rodapé que só',
  '    cita o nome do hospital sem nenhum verbo ligado a ele.',
  'Se o texto não disser em nenhum lugar onde a cirurgia ocorrerá, deixe',
  '`extracted.hospital = null` — não infira a partir do nome da clínica que',
  'EMITIU o laudo (cabeçalho do documento) a menos que o próprio texto deixe',
  'claro que é o mesmo local da cirurgia.',
  '',
  'DIAGNÓSTICO E QUADRO CLÍNICO:',
  '"Diagnóstico:" / "Diagnostico:" / "Hipótese diagnóstica:" / "DH:" →',
  '`extracted.diagnosis` (texto livre, ex.: "Hérnia discal cervical C5-C6 e',
  'C4-C5 com compressão radicular"). Se houver código CID escrito no',
  'documento (ex.: "M50.1") use `extracted.cid`; CASO CONTRÁRIO, deixe',
  '`cid: null` — NÃO invente CID a partir do texto.',
  '',
  'PROCEDIMENTO SUGERIDO:',
  '"Indicado procedimento cirúrgico com X" / "Procedimento proposto:" /',
  '"Cirurgia indicada:" / "Tratamento proposto:" → `extracted.suggestedProcedureName`',
  '(texto livre curto, ex.: "Artrodese cervical anterior C5-C6 e C4-C5"). É',
  'o NOME da cirurgia, NÃO o código TUSS.',
  '',
  'CÓDIGOS TUSS:',
  '"Códigos solicitados:" / "TUSS:" / "Código:" — cada linha vira um item de',
  '`extracted.tuss` com `code` (ex.: "3.07.15.091" ou "30715091") e',
  '`description` (descrição na mesma linha). Se a mesma descrição aparece',
  'várias vezes com códigos diferentes, mantenha cada uma. Quando a linha',
  'terminar com um sufixo de quantidade — ex.: "3.07.15.091 X 2",',
  '"3.07.15.091 x2", "3.07.15.091 (2x)" — esse número vira `tuss[].qty`',
  '(ex.: `qty: 2`). Quando não houver sufixo de quantidade, use `qty: 1`.',
  'Não confunda esse sufixo com parte do código ou da descrição.',
  '',
  'OPME (Órteses, Próteses, Materiais Especiais):',
  '"MATERIAL:" / "OPME:" / "Materiais necessários:" — cada linha geralmente',
  'tem quantidade + descrição. Exemplo: "02 CAGES STAND ALONE" vira',
  '`{description: "CAGES STAND ALONE", qty: 2}`. "01 KIT BIPOLAR" vira',
  '`{description: "KIT BIPOLAR", qty: 1}`. Quando a quantidade não estiver',
  'explícita, use `qty: 1`.',
  '',
  'FORNECEDORES OPME:',
  '"SUGIRO AS EMPRESAS:" / "Fornecedores sugeridos:" / "Distribuidores:" —',
  'liste cada empresa em `extracted.suggestedSuppliers` (apenas o NOME da',
  'distribuidora, ex.: ["SINTEX", "VITALITY", "GUSMED"]). O mesmo vale para',
  'o padrão "materiais fornecidos pela empresa X (empresas para cotação Y e',
  'Z)" — coloque X, Y e Z (todas as 3) em `extracted.suggestedSuppliers`,',
  'mesmo que só X seja a fornecedora principal. Se o documento associar',
  'empresa direto a um material específico, preencha também `opme[].supplier`',
  'no item correspondente. Se houver MARCA/fabricante entre parênteses (ex.:',
  '"SINTEX (DIVA/NOVA SPINE)"), coloque a marca em `opme[].manufacturer`',
  'quando puder associar; senão deixe `null`.',
  '',
  'SEÇÕES DO LAUDO (reportSections):',
  'A plataforma organiza o laudo em seções com título + descrição (igual à',
  'aba de "seções do laudo" do sistema). Divida o texto narrativo do',
  'documento (queixa, histórico, exame físico, achados de exames de',
  'imagem, indicação cirúrgica, justificativa, condutas) nessas seções e',
  'devolva em `extracted.reportSections` como uma lista de',
  '`{title, description}`. Use os títulos que o PRÓPRIO documento sugerir',
  '(ex.: um bloco de história clínica + diagnóstico seguido de achados',
  'numerados de RX/RNM forma UMA seção só, título "Histórico e',
  'Diagnóstico"; o parágrafo de raciocínio/justificativa clínica — e',
  'qualquer parágrafo seguinte que dê continuidade a essa mesma linha de',
  'raciocínio, como otimização de custos ou explicação do propósito de',
  'cada material — forma a seção "Conduta"). Se o documento não tiver uma',
  'divisão clara, use um título genérico como "Laudo" com todo o texto.',
  'Cada `description` deve ser objetiva e útil, com no máximo ~1200',
  'caracteres por seção. Priorize informação clínica central e itens com',
  'impacto na solicitação (diagnóstico, justificativa, exames, conduta).',
  'Preencha também `extracted.laudoText` com a concatenação de todas as',
  'seções (compatibilidade com consumidores antigos que ainda não leem',
  '`reportSections`), limitado a ~2000 caracteres.',
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
  '',
  'IMPORTANTE: laudos cirúrgicos brasileiros (com diagnóstico + procedimento',
  'sugerido + códigos TUSS + OPME + assinatura de médico) devem ser',
  'classificados como `surgery_request` (não `medical_report`), porque vão',
  'virar uma solicitação cirúrgica no sistema.',
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
    const maxTokens = this.getMaxTokens();
    const userPrompt = this.buildUserPrompt(trimmed, opts.intent);

    // Salvaguarda contra regressão do `payload_blob`: se o texto tokenizado
    // veio reduzido a um único placeholder gigante (bug onde
    // `preprocessUserInput` engolia laudos > 1500 chars), o classifier não
    // tem como inferir nada — devolve cedo com aviso explícito em vez de
    // queimar tokens da OpenAI.
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
      // Mantemos configurável via env para ajuste fino sem deploy.
      // Default mais enxuto reduz latência e risco de JSON truncado.
      maxTokens,
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

  private getMaxTokens(): number {
    const raw = this.configService.get<string>(
      'AI_DOC_CLASSIFIER_MAX_TOKENS',
      '1800',
    );
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 1800;
    return Math.max(600, Math.min(4000, Math.floor(parsed)));
  }

  /**
   * Retorna `true` quando o texto enviado consiste essencialmente em UM
   * placeholder de `{{payload_blob_n}}` — sintoma do bug do PII Vault em
   * que o blobThreshold engolia laudos inteiros. Mantemos a heurística
   * permissiva (umas 60 chars de "ruído" toleradas) porque o tokenizador
   * pode adicionar quebras/espaços ao redor.
   */
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
      'addressNumber',
      'addressComplement',
      'neighborhood',
      'city',
      'state',
      'zipCode',
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
          qty:
            typeof item?.qty === 'number' && item.qty >= 1
              ? item.qty
              : undefined,
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
        .map((item: any) => {
          const entry: any = {
            description:
              typeof item?.description === 'string'
                ? item.description.trim()
                : '',
            qty: Number.isFinite(Number(item?.qty))
              ? Math.max(1, Math.floor(Number(item?.qty)))
              : 1,
          };
          if (typeof item?.supplier === 'string' && item.supplier.trim()) {
            entry.supplier = item.supplier.trim();
          }
          if (
            typeof item?.manufacturer === 'string' &&
            item.manufacturer.trim()
          ) {
            entry.manufacturer = item.manufacturer.trim();
          }
          return entry;
        })
        .filter((item: any) => item.description);
      if (opme.length) out.opme = opme;
    }

    if (
      Array.isArray(raw?.suggestedSuppliers) &&
      raw.suggestedSuppliers.length
    ) {
      const suppliers = raw.suggestedSuppliers
        .map((s: any) => (typeof s === 'string' ? s.trim() : ''))
        .filter((s: string) => s.length > 0);
      if (suppliers.length) out.suggestedSuppliers = suppliers;
    }

    if (typeof raw?.diagnosis === 'string' && raw.diagnosis.trim()) {
      out.diagnosis = raw.diagnosis.trim();
    }

    if (
      typeof raw?.suggestedProcedureName === 'string' &&
      raw.suggestedProcedureName.trim()
    ) {
      out.suggestedProcedureName = raw.suggestedProcedureName.trim();
    }

    if (Array.isArray(raw?.reportSections) && raw.reportSections.length) {
      const sections = raw.reportSections
        .map((item: any) => ({
          title: typeof item?.title === 'string' ? item.title.trim() : '',
          description:
            typeof item?.description === 'string'
              ? item.description.trim()
              : '',
        }))
        .filter((item: any) => item.title && item.description);
      if (sections.length) out.reportSections = sections;
    }

    if (typeof raw?.laudoText === 'string' && raw.laudoText.trim()) {
      out.laudoText = raw.laudoText.trim();
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
