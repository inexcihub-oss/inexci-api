import { UnauthorizedException } from '@nestjs/common';
import { WebhookService } from './webhook.service';

function criarService(env: Record<string, string>) {
  const configService = {
    get: jest.fn((chave: string, padrao = '') => env[chave] ?? padrao),
  };
  const service = Object.create(WebhookService.prototype);
  (service as any).configService = configService;
  return service as WebhookService;
}

describe('WebhookService.validateTwilioSignature', () => {
  it('recusa quando TWILIO_AUTH_TOKEN esta vazio em producao', () => {
    const service = criarService({
      NODE_ENV: 'production',
      TWILIO_AUTH_TOKEN: '',
    });

    expect(() =>
      service.validateTwilioSignature('assinatura', ['https://api/x'], {}),
    ).toThrow(UnauthorizedException);
  });

  it('segue pulando validacao em desenvolvimento sem token', () => {
    const service = criarService({
      NODE_ENV: 'development',
      TWILIO_AUTH_TOKEN: '',
    });

    expect(() =>
      service.validateTwilioSignature('assinatura', ['https://api/x'], {}),
    ).not.toThrow();
  });

  it('valida assinatura FORA de producao quando ha token (ex.: staging)', () => {
    // Regressão: antes a validação só ligava em production, então um deploy em
    // staging com token aceitava webhooks forjados. Agora, token presente ⇒
    // valida em qualquer ambiente. Assinatura inválida deve ser recusada.
    const service = criarService({
      NODE_ENV: 'staging',
      TWILIO_AUTH_TOKEN: 'token-secreto',
    });

    expect(() =>
      service.validateTwilioSignature('assinatura-forjada', ['https://api/x'], {
        From: 'whatsapp:+5511999999999',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('honra o opt-out (TWILIO_VALIDATE_SIGNATURE=false) apenas fora de producao', () => {
    const dev = criarService({
      NODE_ENV: 'development',
      TWILIO_VALIDATE_SIGNATURE: 'false',
      TWILIO_AUTH_TOKEN: 'token-secreto',
    });
    expect(() =>
      dev.validateTwilioSignature('qualquer', ['https://api/x'], {}),
    ).not.toThrow();

    // Em produção o opt-out é ignorado: sem assinatura válida, recusa.
    const prod = criarService({
      NODE_ENV: 'production',
      TWILIO_VALIDATE_SIGNATURE: 'false',
      TWILIO_AUTH_TOKEN: 'token-secreto',
    });
    expect(() =>
      prod.validateTwilioSignature('assinatura-forjada', ['https://api/x'], {}),
    ).toThrow(UnauthorizedException);
  });
});
