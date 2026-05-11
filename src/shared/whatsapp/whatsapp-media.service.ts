import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface InboundWhatsappMedia {
  url: string;
  contentType: string | null;
  category?: 'audio' | 'image' | 'pdf' | 'other';
  durationSeconds?: number | null;
}

export interface DownloadedWhatsappAudio {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
  fileName: string;
}

export interface DownloadedWhatsappDocument {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  /** `image` ou `pdf` — definido pelo MIME aceito. */
  kind: 'image' | 'pdf';
}

export type WhatsappMediaErrorCode =
  | 'AUDIO_NOT_ALLOWED'
  | 'AUDIO_TOO_LARGE'
  | 'AUDIO_TOO_LONG'
  | 'MEDIA_URL_INVALID'
  | 'DOC_NOT_ALLOWED'
  | 'DOC_TOO_LARGE'
  | 'DOC_PAGE_LIMIT';

export class WhatsappMediaValidationError extends Error {
  constructor(
    message: string,
    public readonly code: WhatsappMediaErrorCode,
  ) {
    super(message);
    this.name = 'WhatsappMediaValidationError';
  }
}

type MediaKind = 'audio' | 'image' | 'pdf';

@Injectable()
export class WhatsappMediaService {
  constructor(private readonly configService: ConfigService) {}

  isAudioMime(mimeType: string | null | undefined): boolean {
    return (
      typeof mimeType === 'string' &&
      mimeType.toLowerCase().startsWith('audio/')
    );
  }

  isImageMime(mimeType: string | null | undefined): boolean {
    return (
      typeof mimeType === 'string' &&
      mimeType.toLowerCase().startsWith('image/')
    );
  }

  isPdfMime(mimeType: string | null | undefined): boolean {
    return (
      typeof mimeType === 'string' &&
      mimeType.toLowerCase() === 'application/pdf'
    );
  }

  /**
   * Backwards-compatible wrapper para o pipeline de áudio existente.
   */
  async downloadInboundAudio(
    media: InboundWhatsappMedia,
  ): Promise<DownloadedWhatsappAudio> {
    const downloaded = await this.downloadInboundMedia(media, 'audio');
    const durationSeconds = await this.resolveAudioDuration(
      media,
      downloaded.responseHeaders,
    );
    this.validateAudioDuration(durationSeconds);

    await this.persistDebugCopyIfEnabled(
      downloaded.fileName,
      downloaded.buffer,
    );

    return {
      buffer: downloaded.buffer,
      mimeType: downloaded.mimeType,
      sizeBytes: downloaded.buffer.byteLength,
      durationSeconds,
      fileName: downloaded.fileName,
    };
  }

  /**
   * Baixa imagem ou PDF inbound vindo do WhatsApp via Twilio.
   * Aplica whitelist de MIME e limite de bytes específico para documentos.
   */
  async downloadInboundDocument(
    media: InboundWhatsappMedia,
  ): Promise<DownloadedWhatsappDocument> {
    const declaredMime = this.normalizeMime(media.contentType);
    const kind: MediaKind | null = declaredMime
      ? this.isImageMime(declaredMime)
        ? 'image'
        : this.isPdfMime(declaredMime)
          ? 'pdf'
          : null
      : null;

    if (!kind) {
      throw new WhatsappMediaValidationError(
        'Tipo de documento não permitido. Envie uma imagem (JPG/PNG/WEBP) ou um PDF.',
        'DOC_NOT_ALLOWED',
      );
    }

    const downloaded = await this.downloadInboundMedia(media, kind);

    return {
      buffer: downloaded.buffer,
      mimeType: downloaded.mimeType,
      sizeBytes: downloaded.buffer.byteLength,
      fileName: downloaded.fileName,
      kind,
    };
  }

  /**
   * Núcleo do download (auth Twilio, validação de host/mime, leitura com
   * limite). Mantemos privado para que `audio`/`image`/`pdf` reaproveitem o
   * mesmo caminho de erro/observabilidade.
   */
  private async downloadInboundMedia(
    media: InboundWhatsappMedia,
    kind: MediaKind,
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    fileName: string;
    responseHeaders: Headers;
  }> {
    this.ensureTwilioUrl(media.url);

    const declaredMime = this.normalizeMime(media.contentType);
    if (!declaredMime || !this.isAllowedMime(declaredMime, kind)) {
      throw new WhatsappMediaValidationError(
        this.buildNotAllowedMessage(kind),
        this.notAllowedCode(kind),
      );
    }

    const accountSid = this.configService
      .get<string>('TWILIO_ACCOUNT_SID', '')
      .trim();
    const authToken = this.configService
      .get<string>('TWILIO_AUTH_TOKEN', '')
      .trim();

    if (!accountSid || !authToken) {
      throw new Error(
        'Credenciais Twilio ausentes para download de mídia inbound.',
      );
    }

    const controller = new AbortController();
    const timeoutMs = this.configService.get<number>(
      'AI_AUDIO_DOWNLOAD_TIMEOUT_MS',
      15000,
    );
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(media.url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          Accept: '*/*',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Falha ao baixar mídia da Twilio (status ${response.status})`,
        );
      }

      const maxBytes = this.getMaxBytesFor(kind);
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (
        Number.isFinite(contentLength) &&
        contentLength > 0 &&
        contentLength > maxBytes
      ) {
        throw new WhatsappMediaValidationError(
          this.buildTooLargeMessage(kind),
          this.tooLargeCode(kind),
        );
      }

      const responseMime = this.normalizeMime(
        response.headers.get('content-type'),
      );
      const effectiveMime = responseMime || declaredMime;
      if (!effectiveMime || !this.isAllowedMime(effectiveMime, kind)) {
        throw new WhatsappMediaValidationError(
          this.buildNotAllowedMessage(kind),
          this.notAllowedCode(kind),
        );
      }

      const buffer = await this.readResponseWithLimit(response, maxBytes, kind);
      const fileName = this.buildFileName(effectiveMime, kind);

      return {
        buffer,
        mimeType: effectiveMime,
        fileName,
        responseHeaders: response.headers,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private notAllowedCode(kind: MediaKind): WhatsappMediaErrorCode {
    return kind === 'audio' ? 'AUDIO_NOT_ALLOWED' : 'DOC_NOT_ALLOWED';
  }

  private tooLargeCode(kind: MediaKind): WhatsappMediaErrorCode {
    return kind === 'audio' ? 'AUDIO_TOO_LARGE' : 'DOC_TOO_LARGE';
  }

  private buildNotAllowedMessage(kind: MediaKind): string {
    if (kind === 'audio') {
      return 'Tipo de áudio não permitido. Envie áudio em formato suportado.';
    }
    if (kind === 'image') {
      return 'Tipo de imagem não permitido. Envie JPG, PNG ou WEBP.';
    }
    return 'Documento não permitido. Envie um PDF válido.';
  }

  private buildTooLargeMessage(kind: MediaKind): string {
    if (kind === 'audio') {
      return 'Áudio excede o tamanho máximo permitido.';
    }
    return 'Documento excede o tamanho máximo permitido.';
  }

  private getMaxBytesFor(kind: MediaKind): number {
    if (kind === 'audio') {
      return this.configService.get<number>(
        'AI_AUDIO_MAX_BYTES',
        15 * 1024 * 1024,
      );
    }
    return this.configService.get<number>('AI_DOC_MAX_BYTES', 10 * 1024 * 1024);
  }

  private isAllowedMime(mimeType: string, kind: MediaKind): boolean {
    if (kind === 'audio') {
      return this.getAllowedAudioMimes().includes(mimeType.toLowerCase());
    }
    if (kind === 'image') {
      return this.getAllowedImageMimes().includes(mimeType.toLowerCase());
    }
    return this.getAllowedPdfMimes().includes(mimeType.toLowerCase());
  }

  private getAllowedAudioMimes(): string[] {
    const raw = this.configService.get<string>(
      'AI_AUDIO_ALLOWED_MIME',
      'audio/ogg,audio/mpeg,audio/mp4,audio/webm,audio/wav,audio/x-wav',
    );

    return raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  private getAllowedImageMimes(): string[] {
    const raw = this.configService.get<string>(
      'AI_DOC_ALLOWED_IMAGE_MIME',
      'image/jpeg,image/jpg,image/png,image/webp',
    );
    return raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  private getAllowedPdfMimes(): string[] {
    const raw = this.configService.get<string>(
      'AI_DOC_ALLOWED_PDF_MIME',
      'application/pdf',
    );
    return raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  private normalizeMime(value: string | null | undefined): string | null {
    if (!value || typeof value !== 'string') return null;
    const mime = value.split(';')[0]?.trim().toLowerCase();
    return mime || null;
  }

  private ensureTwilioUrl(url: string): void {
    if (!url || typeof url !== 'string') {
      throw new WhatsappMediaValidationError(
        'URL de mídia inválida.',
        'MEDIA_URL_INVALID',
      );
    }

    const normalized = url.toLowerCase();
    const isTrustedHost =
      normalized.startsWith('https://api.twilio.com/') ||
      normalized.startsWith('https://mms.twiliocdn.com/') ||
      normalized.startsWith('https://media.twiliocdn.com/');

    if (!isTrustedHost) {
      throw new WhatsappMediaValidationError(
        'URL de mídia não autorizada.',
        'MEDIA_URL_INVALID',
      );
    }
  }

  private async readResponseWithLimit(
    response: Response,
    maxBytes: number,
    kind: MediaKind,
  ): Promise<Buffer> {
    const stream = response.body;
    if (!stream || typeof (stream as ReadableStream).getReader !== 'function') {
      const payload = Buffer.from(await response.arrayBuffer());
      if (payload.byteLength > maxBytes) {
        throw new WhatsappMediaValidationError(
          this.buildTooLargeMessage(kind),
          this.tooLargeCode(kind),
        );
      }
      return payload;
    }

    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    const chunks: Buffer[] = [];
    let total = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw new WhatsappMediaValidationError(
          this.buildTooLargeMessage(kind),
          this.tooLargeCode(kind),
        );
      }

      chunks.push(chunk);
    }

    return Buffer.concat(chunks, total);
  }

  private async resolveAudioDuration(
    media: InboundWhatsappMedia,
    headers: Headers,
  ): Promise<number | null> {
    if (
      typeof media.durationSeconds === 'number' &&
      Number.isFinite(media.durationSeconds)
    ) {
      return media.durationSeconds;
    }

    const headerCandidates = [
      headers.get('x-media-duration'),
      headers.get('x-twilio-duration'),
      headers.get('content-duration'),
    ];

    for (const value of headerCandidates) {
      if (!value) continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return null;
  }

  private validateAudioDuration(durationSeconds: number | null): void {
    if (durationSeconds === null) return;

    const maxDuration = this.configService.get<number>(
      'AI_AUDIO_MAX_DURATION_SECONDS',
      300,
    );

    if (durationSeconds > maxDuration) {
      throw new WhatsappMediaValidationError(
        'Áudio excede a duração máxima permitida.',
        'AUDIO_TOO_LONG',
      );
    }
  }

  private buildFileName(mimeType: string, kind: MediaKind): string {
    const audioExtMap: Record<string, string> = {
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/webm': 'webm',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
    };

    const docExtMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    };

    if (kind === 'audio') {
      const extension = audioExtMap[mimeType] || 'bin';
      return `whatsapp-audio-${Date.now()}.${extension}`;
    }

    const extension = docExtMap[mimeType] || 'bin';
    return `whatsapp-doc-${Date.now()}.${extension}`;
  }

  private async persistDebugCopyIfEnabled(
    fileName: string,
    content: Buffer,
  ): Promise<void> {
    const enabledRaw = this.configService.get<string>(
      'AI_AUDIO_DEBUG_PERSIST',
      'false',
    );
    const enabled =
      enabledRaw.trim().toLowerCase() === 'true' || enabledRaw.trim() === '1';

    if (!enabled) return;

    const debugDir = this.configService.get<string>(
      'AI_AUDIO_DEBUG_DIR',
      '/tmp/inexci-audio-debug',
    );
    await fs.mkdir(debugDir, { recursive: true });
    await fs.writeFile(path.join(debugDir, fileName), content);

    const retentionHours = this.configService.get<number>(
      'AI_AUDIO_DEBUG_RETENTION_HOURS',
      24,
    );
    const threshold = Date.now() - retentionHours * 60 * 60 * 1000;

    const files = await fs.readdir(debugDir);
    await Promise.all(
      files.map(async (entry) => {
        const absolute = path.join(debugDir, entry);
        try {
          const stat = await fs.stat(absolute);
          if (stat.isFile() && stat.mtimeMs < threshold) {
            await fs.unlink(absolute);
          }
        } catch {
          // ignora erros de limpeza de debug
        }
      }),
    );
  }
}
