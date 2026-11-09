import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errorMessage } from 'src/shared/utils/error-message.util';
import { maskSensitiveText } from 'src/shared/utils/mask.util';

export interface LokiLogLine {
  timestamp: Date;
  level: string | null;
  message: string;
  context: string | null;
  requestId: string | null;
  traceId: string | null;
}

export interface LokiQueryRange {
  from: Date;
  to: Date;
  limit: number;
}

export class LokiUnavailableError extends Error {}

interface LokiStream {
  values?: Array<[string, string]>;
}

interface LokiResponse {
  data?: { result?: LokiStream[] };
}

const TIMEOUT_MS = 4000;
const MESSAGE_MAX = 500;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function escapeLogqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function parseLokiLine(timestampNs: string, line: string): LokiLogLine {
  let parsed: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(line);
    if (value && typeof value === 'object') {
      parsed = value as Record<string, unknown>;
    }
  } catch {}
  const rawMessage = asString(parsed?.message) ?? asString(parsed?.msg) ?? line;
  const message = maskSensitiveText(rawMessage);
  return {
    timestamp: new Date(Number(BigInt(timestampNs) / 1_000_000n)),
    level: asString(parsed?.level),
    message:
      message.length > MESSAGE_MAX
        ? `${message.slice(0, MESSAGE_MAX - 3)}...`
        : message,
    context: asString(parsed?.context),
    requestId: asString(parsed?.requestId),
    traceId: asString(parsed?.traceId),
  };
}

@Injectable()
export class GrafanaLokiClient {
  private readonly logger = new Logger(GrafanaLokiClient.name);

  constructor(private readonly config: ConfigService) {}

  get service(): string {
    return this.config.get<string>('GRAFANA_LOKI_SERVICE') || 'inexci-api';
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('GRAFANA_LOKI_READ_URL') &&
      this.config.get<string>('GRAFANA_LOKI_READ_USER') &&
      this.config.get<string>('GRAFANA_LOKI_READ_TOKEN'),
    );
  }

  queryForRequests(ids: string[]): string {
    const pattern = ids.map((id) => escapeLogqlString(id)).join('|');
    return `{service="${escapeLogqlString(this.service)}"} |~ "${pattern}" | json`;
  }

  queryForUsers(userIds: string[], marker: string): string {
    const pattern = userIds.map((id) => escapeLogqlString(id)).join('|');
    return `{service="${escapeLogqlString(this.service)}"} |= "${escapeLogqlString(marker)}" |~ "${pattern}" | json`;
  }

  async searchByRequestIds(
    ids: string[],
    range: LokiQueryRange,
  ): Promise<LokiLogLine[]> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return [];
    return this.run(this.queryForRequests(unique), range);
  }

  async searchUserEvents(
    userIds: string[],
    marker: string,
    range: LokiQueryRange,
  ): Promise<LokiLogLine[]> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return [];
    return this.run(this.queryForUsers(unique, marker), range);
  }

  private async run(
    query: string,
    range: LokiQueryRange,
  ): Promise<LokiLogLine[]> {
    if (!this.isConfigured()) throw new LokiUnavailableError('not_configured');

    const base = String(
      this.config.get<string>('GRAFANA_LOKI_READ_URL'),
    ).replace(/\/+$/, '');
    const params = new URLSearchParams({
      query,
      start: `${range.from.getTime()}000000`,
      end: `${range.to.getTime()}000000`,
      limit: String(range.limit),
      direction: 'backward',
    });
    const auth = Buffer.from(
      `${this.config.get<string>('GRAFANA_LOKI_READ_USER')}:${this.config.get<string>('GRAFANA_LOKI_READ_TOKEN')}`,
    ).toString('base64');

    let response: Response;
    try {
      response = await fetch(`${base}/loki/api/v1/query_range?${params}`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`[LOKI_READ_FAILED] ${errorMessage(err)}`);
      throw new LokiUnavailableError('request_failed');
    }
    if (!response.ok) {
      this.logger.warn(`[LOKI_READ_FAILED] status=${response.status}`);
      throw new LokiUnavailableError(`status_${response.status}`);
    }
    const body = (await response.json()) as LokiResponse;
    const lines = (body.data?.result ?? []).flatMap((stream) =>
      (stream.values ?? []).map(([ts, line]) => parseLokiLine(ts, line)),
    );
    return lines
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, range.limit);
  }
}
