import { AuthController } from './auth.controller';

const THROTTLERS_CONFIGURADOS = ['short', 'medium', 'long'];

const ROTAS_COM_LIMITE = [
  'checkEmail',
  'checkPhone',
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
