import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGatewayError } from '../../payment-gateway.interface';
import { AsaasErrorResponse } from './asaas.types';

/**
 * Cliente HTTP fino para a API REST da Asaas.
 *
 * - Usa `fetch` nativo (Node 18+) para evitar adicionar dependencia.
 * - Centraliza autentica\u00e7\u00e3o (header `access_token`), normaliza\u00e7\u00e3o de
 *   erros e timeouts.
 * - N\u00e3o faz nenhuma l\u00f3gica de neg\u00f3cio: tudo isso fica em `AsaasProvider`.
 */
@Injectable()
export class AsaasHttpClient {
  private readonly logger = new Logger(AsaasHttpClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config
      .get<string>('ASAAS_API_URL', 'https://api-sandbox.asaas.com/v3')
      .replace(/\/+$/, '');
    this.apiKey = this.config.get<string>('ASAAS_API_KEY', '');
    this.timeoutMs = Number(
      this.config.get<number>('ASAAS_REQUEST_TIMEOUT_MS', 15000),
    );
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new PaymentGatewayError(
        'ASAAS_API_KEY n\u00e3o configurada',
        'GATEWAY_NOT_CONFIGURED',
      );
    }

    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          access_token: this.apiKey,
          'User-Agent': 'inexci-api/1.0',
        },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new PaymentGatewayError(
        isAbort
          ? `Timeout (${this.timeoutMs}ms) ao chamar Asaas: ${method} ${path}`
          : `Falha de rede ao chamar Asaas: ${err instanceof Error ? err.message : String(err)}`,
        isAbort ? 'GATEWAY_TIMEOUT' : 'GATEWAY_NETWORK_ERROR',
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // mant\u00e9m parsed undefined, segue para tratamento de erro abaixo
      }
    }

    if (!response.ok) {
      const errPayload = parsed as AsaasErrorResponse | undefined;
      const description =
        errPayload?.errors?.[0]?.description ||
        `HTTP ${response.status} em ${method} ${path}`;
      const code = errPayload?.errors?.[0]?.code || `HTTP_${response.status}`;
      this.logger.warn(
        `[Asaas] ${method} ${path} falhou: ${response.status} ${description}`,
      );
      throw new PaymentGatewayError(description, code, response.status, parsed);
    }

    return parsed as T;
  }
}
