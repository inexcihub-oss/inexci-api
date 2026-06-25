import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_FOLDERS } from '../../../config/storage.config';
import { StorageService } from '../../storage/storage.service';
import {
  InboundWhatsappMedia,
  WhatsappMediaService,
  WhatsappMediaValidationError,
} from '../../whatsapp/whatsapp-media.service';
import { AiRedisService } from './ai-redis.service';
import { DocumentClassification } from '../ocr/document-classifier.types';

const PENDING_DOC_REDIS_KEY_PREFIX = 'doc:pending:';

export type DocumentIntent = 'attach' | 'create_sc' | 'create_patient';

/**
 * Estado guardado por telefone enquanto o assistente espera o usuário
 * decidir o que fazer com a mídia recém enviada (anexar a uma SC, criar SC
 * a partir dela ou cadastrar paciente). Esse staging permite separar a
 * etapa de DOWNLOAD da etapa de PROCESSAMENTO PESADO (OCR/LLM).
 *
 * Persistido preferencialmente no Redis (`AiRedisService`) para sobreviver
 * a restarts do worker; cai num cache in-memory quando Redis indisponível.
 */
export interface PendingDocumentRequest {
  /** Path completo no bucket Supabase (ex.: `whatsapp-tmp/<uuid>-<file>`). */
  storagePath: string;
  /** MIME efetivo retornado pelo Twilio (ex.: `application/pdf`). */
  contentType: string;
  /** Tamanho em bytes do arquivo baixado. */
  sizeBytes: number;
  /** Nome do arquivo já normalizado pelo media service. */
  fileName: string;
  /** `image` ou `pdf` — determinado pelo MIME. */
  kind: 'image' | 'pdf';
  /** Epoch ms em que foi recebido pelo webhook. */
  receivedAt: number;
  /** Epoch ms a partir do qual a pendência deve ser descartada. */
  expiresAt: number;
  /** SID da mensagem Twilio (correlation id). */
  messageSid: string;

  // ---- Estendido no Sprint 3 (OCR + classificador) ----
  /** Intent reconhecida pelo dispatcher quando o usuário respondeu 1/2/3. */
  intent?: DocumentIntent;
  /** Resultado do `DocumentClassifierService` (após OCR + LLM). */
  classification?: DocumentClassification;
  /** Epoch ms em que a classificação foi concluída. */
  classifiedAt?: number;
  /**
   * Texto OCR já tokenizado pelo PII Vault. Mantido junto da pendência
   * para que tools (`attach_document_from_whatsapp`) possam, no futuro,
   * gravar o laudo extraído sem chamar OCR de novo.
   */
  ocrTokenizedText?: string;
}

export type PendingDownloadFailureReason =
  | 'DOC_NOT_ALLOWED'
  | 'DOC_TOO_LARGE'
  | 'MEDIA_URL_INVALID'
  | 'STORAGE_ERROR'
  | 'UNKNOWN';

export interface DocumentDispatchOutcome {
  status: 'no_document' | 'staged' | 'failed';
  pending?: PendingDocumentRequest;
  failureReason?: PendingDownloadFailureReason;
  failureMessage?: string;
}

interface InMemoryEntry {
  value: PendingDocumentRequest;
  expiresAt: number;
}

@Injectable()
export class WhatsappDocumentDispatcherService {
  private readonly logger = new Logger(WhatsappDocumentDispatcherService.name);
  private readonly inMemoryStore = new Map<string, InMemoryEntry>();

  constructor(
    private readonly configService: ConfigService,
    private readonly mediaService: WhatsappMediaService,
    private readonly storageService: StorageService,
    private readonly redis: AiRedisService,
  ) {}

  isEnabled(): boolean {
    const raw = this.configService.get<string>('AI_DOC_ENABLED', 'true');
    const normalized = String(raw).trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }

  /**
   * Para um conjunto de mídias inbound, retorna a primeira que é imagem ou
   * PDF (ignora áudio — esse fluxo permanece com o STT). Múltiplos arquivos
   * na mesma mensagem WhatsApp são raros; pegamos o primeiro.
   */
  pickDocumentMedia(
    media:
      | Array<{
          url: string;
          contentType: string | null;
          category: 'audio' | 'image' | 'pdf' | 'other';
        }>
      | undefined,
  ): InboundWhatsappMedia | null {
    if (!media || !media.length) return null;
    const target = media.find((item) => {
      if (item.category === 'image' || item.category === 'pdf') return true;
      if (item.category === 'audio') return false;
      // category === 'other' — checa MIME por garantia (clientes antigos
      // mandavam tudo como `other`).
      return (
        this.mediaService.isImageMime(item.contentType) ||
        this.mediaService.isPdfMime(item.contentType)
      );
    });
    if (!target) return null;
    return {
      url: target.url,
      contentType: target.contentType,
      category: target.category,
    };
  }

  /**
   * Baixa o documento, persiste na pasta tmp e grava a pendência por
   * telefone. Não chama OCR nem LLM. Usado pelo orchestrator antes de
   * decidir se deve perguntar a intent ao usuário.
   */
  async stageInboundDocument(opts: {
    media: InboundWhatsappMedia;
    phone: string;
    messageSid: string;
  }): Promise<DocumentDispatchOutcome> {
    if (!this.isEnabled()) {
      return { status: 'no_document' };
    }

    try {
      const downloaded = await this.mediaService.downloadInboundDocument(
        opts.media,
      );

      const folder = this.configService.get<string>(
        'AI_DOC_TMP_FOLDER',
        STORAGE_FOLDERS.WHATSAPP_TMP,
      );

      const storagePath = await this.storageService.uploadBuffer(
        downloaded.buffer,
        folder,
        downloaded.fileName,
        downloaded.mimeType,
      );

      const ttlMinutes = this.getPendingTtlMinutes();
      const now = Date.now();
      const pending: PendingDocumentRequest = {
        storagePath,
        contentType: downloaded.mimeType,
        sizeBytes: downloaded.sizeBytes,
        fileName: downloaded.fileName,
        kind: downloaded.kind,
        receivedAt: now,
        expiresAt: now + ttlMinutes * 60 * 1000,
        messageSid: opts.messageSid,
      };

      await this.savePending(opts.phone, pending);

      this.logger.log(
        `[AI_DOC] sid=${opts.messageSid} phone=${this.maskPhone(opts.phone)} mime=${downloaded.mimeType} bytes=${downloaded.sizeBytes} kind=${downloaded.kind} stored=${storagePath}`,
      );

      return { status: 'staged', pending };
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);

      let reason: PendingDownloadFailureReason = 'UNKNOWN';
      if (error instanceof WhatsappMediaValidationError) {
        if (
          error.code === 'DOC_NOT_ALLOWED' ||
          error.code === 'DOC_TOO_LARGE' ||
          error.code === 'MEDIA_URL_INVALID'
        ) {
          reason = error.code;
        }
      } else if (/upload|storage/i.test(errMessage)) {
        reason = 'STORAGE_ERROR';
      }

      this.logger.warn(
        `[AI_DOC] sid=${opts.messageSid} phone=${this.maskPhone(opts.phone)} status=failure reason=${reason} message=${errMessage}`,
      );

      return {
        status: 'failed',
        failureReason: reason,
        failureMessage: errMessage,
      };
    }
  }

  /**
   * Mensagem amigável para o usuário quando o staging do documento falha.
   * Mantém o tom didático (mostra alternativa) — espelha o padrão usado em
   * `buildAudioFailureUserMessage` no orchestrator.
   */
  buildDownloadFailureMessage(reason: PendingDownloadFailureReason): string {
    switch (reason) {
      case 'DOC_NOT_ALLOWED':
        return 'Esse formato de arquivo não é suportado por aqui. Por favor, envie uma imagem (JPG, PNG ou WEBP) ou um PDF.';
      case 'DOC_TOO_LARGE':
        return 'O arquivo é muito grande. Por favor, envie um arquivo menor (até 10 MB) ou anexe direto pela plataforma web.';
      case 'MEDIA_URL_INVALID':
        return 'Não consegui baixar o arquivo enviado. Tente reenviar em alguns instantes ou anexe pelo painel web.';
      case 'STORAGE_ERROR':
        return 'Recebi seu arquivo, mas não consegui armazená-lo agora. Tente novamente em alguns minutos.';
      default:
        return 'Não consegui processar o arquivo desta vez. Tente reenviar ou anexe pelo painel web.';
    }
  }

  /**
   * Mensagem do "intent gate" enviada ao usuário após o documento ser
   * staged. Texto livre, conversacional: sugere as opções mais comuns mas
   * deixa claro que o usuário pode descrever outra coisa. As opções
   * numeradas continuam funcionando porque `parseIntent` reconhece tanto
   * dígitos quanto verbos ("anexar", "criar SC", "cadastrar paciente",
   * "cancelar").
   */
  buildIntentPromptMessage(): string {
    return [
      'Recebi seu arquivo, posso te ajudar a usá-lo. Algumas formas comuns:',
      '',
      '1 - Anexar a uma solicitação cirúrgica existente',
      '2 - Criar uma nova solicitação cirúrgica a partir dele',
      '3 - Cadastrar um paciente novo com esses dados',
      '',
      'Pode responder com o número, com o que prefere fazer ou pedir outra coisa que eu te ajudo. Se preferir descartar, é só dizer "cancelar".',
    ].join('\n');
  }

  /**
   * Tenta interpretar a resposta do usuário ao intent prompt. Retorna
   * `null` se o input não for claramente uma intent (mantém o fluxo de
   * conversa normal).
   */
  parseIntent(
    input: string | null | undefined,
  ): DocumentIntent | 'cancel' | null {
    if (!input) return null;
    const normalized = input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

    if (!normalized) return null;

    if (/^1\b|anexar|anex(o|ar)/.test(normalized)) return 'attach';
    if (
      /^2\b|criar (uma )?(nova )?(solicit|sc)|nova sc|nova solicit|criar sc/.test(
        normalized,
      )
    ) {
      return 'create_sc';
    }
    if (
      /^3\b|cadastrar paciente|criar paciente|novo paciente/.test(normalized)
    ) {
      return 'create_patient';
    }
    if (
      /^cancelar$|^cancela$|^descartar$|^remover$|^apagar$/.test(normalized)
    ) {
      return 'cancel';
    }
    return null;
  }

  async getPending(phone: string): Promise<PendingDocumentRequest | null> {
    const key = this.buildKey(phone);

    if (this.redis.isAvailable) {
      const cached = await this.redis.cacheGet<PendingDocumentRequest>(key);
      if (cached) {
        if (cached.expiresAt > Date.now()) return cached;
        await this.redis.cacheDelete(key);
        this.logExpired(phone, cached, 'redis');
      }
    }

    const entry = this.inMemoryStore.get(phone);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.inMemoryStore.delete(phone);
      this.logExpired(phone, entry.value, 'memory');
      return null;
    }
    return entry.value;
  }

  private logExpired(
    phone: string,
    pending: PendingDocumentRequest,
    source: 'redis' | 'memory',
  ): void {
    const waitedMinutes = Math.max(
      0,
      Math.round((Date.now() - pending.receivedAt) / 60_000),
    );
    this.logger.log(
      `[AI_DOC_PENDING_EXPIRED] phone=${this.maskPhone(phone)} source=${source} waited_minutes=${waitedMinutes} sid=${pending.messageSid ?? '-'} mime=${pending.contentType} kind=${pending.kind}`,
    );
  }

  async savePending(
    phone: string,
    pending: PendingDocumentRequest,
  ): Promise<void> {
    const key = this.buildKey(phone);
    const ttlSeconds = Math.max(
      30,
      Math.floor((pending.expiresAt - Date.now()) / 1000),
    );

    if (this.redis.isAvailable) {
      await this.redis.cacheSet(key, pending, ttlSeconds);
    }
    this.inMemoryStore.set(phone, {
      value: pending,
      expiresAt: pending.expiresAt,
    });
  }

  async clearPending(phone: string): Promise<void> {
    const key = this.buildKey(phone);
    if (this.redis.isAvailable) {
      await this.redis.cacheDelete(key);
    }
    this.inMemoryStore.delete(phone);
  }

  /**
   * Apaga o arquivo da pasta tmp (após anexar definitivo, descartar ou
   * expirar). Falhas são logadas mas não propagadas — o cron ainda limpa
   * eventuais resíduos.
   */
  async deleteStoragePath(storagePath: string): Promise<void> {
    if (!storagePath) return;
    try {
      await this.storageService.delete(storagePath);
    } catch (err) {
      this.logger.warn(
        `[AI_DOC] falha ao apagar tmp ${storagePath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private getPendingTtlMinutes(): number {
    const value = this.configService.get<number>(
      'AI_DOC_PENDING_TTL_MINUTES',
      10,
    );
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 10;
    return Math.floor(numeric);
  }

  private buildKey(phone: string): string {
    return `${PENDING_DOC_REDIS_KEY_PREFIX}${phone}`;
  }

  private maskPhone(phone: string): string {
    if (!phone) return 'unknown';
    if (phone.length <= 4) return phone;
    return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
  }
}
