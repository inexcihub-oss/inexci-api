import { ConfigService } from '@nestjs/config';

const TRUSTED_MEDIA_PREFIXES = [
  'https://api.twilio.com/',
  'https://mms.twiliocdn.com/',
  'https://media.twiliocdn.com/',
];

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;

export class TwilioMediaUrlError extends Error {}

export function assertTrustedTwilioMediaUrl(url: unknown): void {
  if (!url || typeof url !== 'string') {
    throw new TwilioMediaUrlError('URL de mídia inválida.');
  }
  const normalized = url.toLowerCase();
  const trusted = TRUSTED_MEDIA_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
  if (!trusted) {
    throw new TwilioMediaUrlError('URL de mídia não autorizada.');
  }
}

async function readWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const stream = response.body as ReadableStream<Uint8Array> | null;
  if (!stream || typeof stream.getReader !== 'function') {
    const payload = Buffer.from(await response.arrayBuffer());
    if (payload.byteLength > maxBytes) {
      throw new TwilioMediaUrlError('Mídia excede o tamanho máximo permitido.');
    }
    return payload;
  }

  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TwilioMediaUrlError('Mídia excede o tamanho máximo permitido.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function downloadTwilioInboundMedia(
  url: string,
  configService: ConfigService | undefined,
  fileNamePrefix = 'media',
): Promise<{ buffer: Buffer; contentType: string | null; fileName: string }> {
  assertTrustedTwilioMediaUrl(url);

  const sid = configService?.get<string>('TWILIO_ACCOUNT_SID', '') || '';
  const token = configService?.get<string>('TWILIO_AUTH_TOKEN', '') || '';
  const maxBytes =
    configService?.get<number>('AI_AUDIO_MAX_BYTES', DEFAULT_MAX_BYTES) ||
    DEFAULT_MAX_BYTES;
  const timeoutMs =
    configService?.get<number>(
      'AI_AUDIO_DOWNLOAD_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
    ) || DEFAULT_TIMEOUT_MS;

  const headers: Record<string, string> = {};
  if (sid && token) {
    headers.Authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString(
      'base64',
    )}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`falha no download da mídia (${response.status})`);
    }
    const buffer = await readWithLimit(response, maxBytes);
    const contentType = response.headers.get('content-type');
    const urlPath = new URL(url).pathname;
    const fileName = urlPath.split('/').pop() || `${fileNamePrefix}-download`;
    return { buffer, contentType, fileName };
  } finally {
    clearTimeout(timer);
  }
}
