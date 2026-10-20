import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const TURNSTILE_TIMEOUT_MS = 5000;

export const CAPTCHA_OBRIGATORIO_MENSAGEM =
  'Conclua a verificação de segurança para continuar.';
export const CAPTCHA_INVALIDO_MENSAGEM =
  'Verificação de segurança inválida ou expirada. Tente novamente.';

interface TurnstileResposta {
  success?: boolean;
  'error-codes'?: string[];
}

@Injectable()
export class TurnstileService implements OnModuleInit {
  private readonly logger = new Logger(TurnstileService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    if (
      this.configService.get<string>('NODE_ENV') === 'production' &&
      !this.secret()
    ) {
      this.logger.warn(
        '[CAPTCHA] TURNSTILE_SECRET_KEY ausente em produção: o cadastro está sem captcha.',
      );
    }
  }

  private secret(): string {
    return (
      this.configService.get<string>('TURNSTILE_SECRET_KEY') ?? ''
    ).trim();
  }

  async assertHuman(token: string | undefined, remoteIp?: string) {
    const secret = this.secret();
    if (!secret) return;

    const resposta = (token ?? '').trim();
    if (!resposta) {
      throw new BadRequestException(CAPTCHA_OBRIGATORIO_MENSAGEM);
    }

    const corpo = new URLSearchParams({ secret, response: resposta });
    if (remoteIp) corpo.set('remoteip', remoteIp);

    let resultado: TurnstileResposta;
    try {
      const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: corpo.toString(),
        signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      resultado = (await response.json()) as TurnstileResposta;
    } catch (err) {
      this.logger.error(
        `[CAPTCHA] Falha ao validar o token no Turnstile: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível validar a verificação de segurança. Tente novamente em instantes.',
      );
    }

    if (resultado.success !== true) {
      this.logger.warn(
        `[CAPTCHA] Token recusado: ${(resultado['error-codes'] ?? []).join(',') || 'sem código'}`,
      );
      throw new BadRequestException(CAPTCHA_INVALIDO_MENSAGEM);
    }
  }
}
