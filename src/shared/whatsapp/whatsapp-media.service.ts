import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface InboundWhatsappMedia {
  url: string;
  contentType: string | null;
  category?: 'audio' | 'other';
  durationSeconds?: number | null;
}

export interface DownloadedWhatsappAudio {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
  fileName: string;
}

export class WhatsappMediaValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'AUDIO_NOT_ALLOWED'
      | 'AUDIO_TOO_LARGE'
      | 'AUDIO_TOO_LONG'
      | 'MEDIA_URL_INVALID',
  ) {
    super(message);
    this.name = 'WhatsappMediaValidationError';
  }
}

@Injectable()
export class WhatsappMediaService {
  constructor(private readonly configService: ConfigService) {}

  isAudioMime(mimeType: string | null | undefined): boolean {
    return (
      typeof mimeType === 'string' &&
      mimeType.toLowerCase().startsWith('audio/')
    );
  }

  async downloadInboundAudio(
    media: InboundWhatsappMedia,
  ): Promise<DownloadedWhatsappAudio> {
    this.ensureTwilioUrl(media.url);

    const declaredMime = this.normalizeMime(media.contentType);
    if (!declaredMime || !this.isAllowedAudioMime(declaredMime)) {
      throw new WhatsappMediaValidationError(
        'Tipo de áudio não permitido. Envie áudio em formato suportado.',
        'AUDIO_NOT_ALLOWED',
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

      const maxBytes = this.configService.get<number>(
        'AI_AUDIO_MAX_BYTES',
        15 * 1024 * 1024,
      );
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (
        Number.isFinite(contentLength) &&
        contentLength > 0 &&
        contentLength > maxBytes
      ) {
        throw new WhatsappMediaValidationError(
          'Áudio excede o tamanho máximo permitido.',
          'AUDIO_TOO_LARGE',
        );
      }

      const responseMime = this.normalizeMime(
        response.headers.get('content-type'),
      );
      const effectiveMime = responseMime || declaredMime;
      if (!effectiveMime || !this.isAllowedAudioMime(effectiveMime)) {
        throw new WhatsappMediaValidationError(
          'Tipo de áudio retornado não é permitido.',
          'AUDIO_NOT_ALLOWED',
        );
      }

      const buffer = await this.readResponseWithLimit(response, maxBytes);
      const durationSeconds = this.extractDurationSeconds(
        media,
        response.headers,
      );
      this.validateDuration(durationSeconds);

      const fileName = this.buildFileName(effectiveMime);
      await this.persistDebugCopyIfEnabled(fileName, buffer);

      return {
        buffer,
        mimeType: effectiveMime,
        sizeBytes: buffer.byteLength,
        durationSeconds,
        fileName,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeMime(value: string | null | undefined): string | null {
    if (!value || typeof value !== 'string') return null;
    const mime = value.split(';')[0]?.trim().toLowerCase();
    return mime || null;
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

  private isAllowedAudioMime(mimeType: string): boolean {
    const allowed = this.getAllowedAudioMimes();
    return allowed.includes(mimeType.toLowerCase());
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
  ): Promise<Buffer> {
    const stream = response.body;
    if (!stream || typeof (stream as ReadableStream).getReader !== 'function') {
      const payload = Buffer.from(await response.arrayBuffer());
      if (payload.byteLength > maxBytes) {
        throw new WhatsappMediaValidationError(
          'Áudio excede o tamanho máximo permitido.',
          'AUDIO_TOO_LARGE',
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
          'Áudio excede o tamanho máximo permitido.',
          'AUDIO_TOO_LARGE',
        );
      }

      chunks.push(chunk);
    }

    return Buffer.concat(chunks, total);
  }

  private extractDurationSeconds(
    media: InboundWhatsappMedia,
    headers: Headers,
  ): number | null {
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

  private validateDuration(durationSeconds: number | null): void {
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

  private buildFileName(mimeType: string): string {
    const extensionMap: Record<string, string> = {
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/webm': 'webm',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
    };

    const extension = extensionMap[mimeType] || 'bin';
    return `whatsapp-audio-${Date.now()}.${extension}`;
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
