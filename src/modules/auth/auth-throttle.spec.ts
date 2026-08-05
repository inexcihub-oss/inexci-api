import { AuthController } from './auth.controller';

/**
 * Os throttlers nomeados registrados em app.module.ts. Um @Throttle com chave
 * fora desta lista é silenciosamente ignorado pelo ThrottlerGuard.
 */
const THROTTLERS_CONFIGURADOS = ['short', 'medium', 'long'];

/** Rotas que precisam de limite próprio, mais estrito que o global. */
const ROTAS_COM_LIMITE = [
  'checkEmail',
  'login',
  'sendRecoveryPasswordEmail',
  'validateRecoveryPasswordCode',
  'changePassword',
  'refresh',
  'verifyEmail',
  'resendEmailVerification',
];

describe('AuthController — rate limiting', () => {
  it.each(ROTAS_COM_LIMITE)(
    'rota %s usa um nome de throttler que existe na configuração',
    (metodo) => {
      const handler = (AuthController.prototype as any)[metodo];
      expect(handler).toBeDefined();

      // O decorator @Throttle grava metadata em THROTTLER_LIMIT + <nome>.
      const chaves: string[] = Reflect.getMetadataKeys(handler) ?? [];
      const chavesDeLimite = chaves.filter((k) =>
        String(k).startsWith('THROTTLER:LIMIT'),
      );

      expect(chavesDeLimite.length).toBeGreaterThan(0);

      for (const chave of chavesDeLimite) {
        const nome = String(chave).replace('THROTTLER:LIMIT', '');
        expect(THROTTLERS_CONFIGURADOS).toContain(nome);
      }
    },
  );
});
