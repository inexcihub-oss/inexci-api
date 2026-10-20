import { AuthController } from './auth.controller';

const THROTTLERS_CONFIGURADOS = ['short', 'medium', 'long'];

const ROTAS_COM_LIMITE = [
  'register',
  'checkEmail',
  'checkPhone',
  'login',
  'sendRecoveryPasswordEmail',
  'validateRecoveryPasswordCode',
  'changePassword',
  'refresh',
  'verifyEmail',
  'resendEmailVerification',
  'loginMfa',
  'mfaSetup',
  'mfaEnable',
  'mfaDisable',
  'mfaRecoveryCodes',
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

  const limiteNomeado = (metodo: string, nome: string) => {
    const handler = (AuthController.prototype as any)[metodo];
    return Reflect.getMetadata(`THROTTLER:LIMIT${nome}`, handler) as
      | number
      | undefined;
  };

  it('cadastro tem limite por hora mais restrito que as checagens do wizard', () => {
    expect(limiteNomeado('register', 'long')).toBeLessThanOrEqual(5);
    expect(limiteNomeado('register', 'long')).toBeLessThan(
      limiteNomeado('checkEmail', 'long') as number,
    );
  });

  it('check-email e check-phone ficam em no máximo 10 por hora', () => {
    expect(limiteNomeado('checkEmail', 'long')).toBeLessThanOrEqual(10);
    expect(limiteNomeado('checkPhone', 'long')).toBeLessThanOrEqual(10);
  });

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

  it('rotas de MFA ficam no mesmo patamar curto do login', () => {
    for (const metodo of [
      'loginMfa',
      'mfaSetup',
      'mfaEnable',
      'mfaDisable',
      'mfaRecoveryCodes',
    ]) {
      expect(limiteNomeado(metodo, 'short')).toBeLessThanOrEqual(5);
      expect(limiteNomeado(metodo, 'long')).toBeLessThanOrEqual(20);
    }
  });
});
