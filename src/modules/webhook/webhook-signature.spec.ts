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
});
