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

  /**
   * `refresh` não é rota de credencial digitada: a aplicação o chama sozinha,
   * uma vez por carregamento de página e por aba (o access token só existe em
   * memória). Com o teto de 10/min que ele tinha, quem navegava rápido ou
   * mantinha algumas abas abertas recebia 429 — e o front tratava isso como
   * sessão encerrada, mandando para o login com o cookie ainda válido.
   */
  it('refresh tolera uso normal de várias abas (limite bem acima do de login)', () => {
    const limite = (metodo: string) => {
      const handler = (AuthController.prototype as any)[metodo];
      const chave = (Reflect.getMetadataKeys(handler) ?? []).find((k: string) =>
        String(k).startsWith('THROTTLER:LIMIT'),
      );
      return Reflect.getMetadata(chave as string, handler) as number;
    };

    expect(limite('refresh')).toBeGreaterThanOrEqual(30);
    expect(limite('refresh')).toBeGreaterThan(limite('login'));
  });
});
