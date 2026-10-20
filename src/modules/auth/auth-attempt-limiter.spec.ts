class FakeRedis {
  status: 'ready' | 'connecting' | 'end' = 'ready';
  store = new Map<string, string>();
  ttls = new Map<string, number>();

  connect = jest.fn().mockResolvedValue(undefined);
  disconnect = jest.fn();

  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    ttl: string,
  ): Promise<number> {
    const n = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(n));
    if (n === 1) this.ttls.set(key, Number(ttl));
    return n;
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async exists(key: string): Promise<number> {
    return this.store.has(key) ? 1 : 0;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  multi() {
    const ops: Array<() => void> = [];
    const builder = {
      set: (key: string, value: string, _ex: string, ttl: number) => {
        ops.push(() => {
          this.store.set(key, value);
          this.ttls.set(key, ttl);
        });
        return builder;
      },
      del: (key: string) => {
        ops.push(() => this.store.delete(key));
        return builder;
      },
      exec: async () => {
        ops.forEach((op) => op());
        return [];
      },
    };
    return builder;
  }
}

let fakeRedis: FakeRedis;

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => fakeRedis),
}));

import {
  AuthAttemptLimiter,
  LOGIN_BLOQUEIO_SEGUNDOS,
  LOGIN_MAX_FALHAS,
  MFA_BLOQUEIO_SEGUNDOS,
  MFA_MAX_FALHAS,
  RECOVERY_MAX_EMISSOES,
  RECOVERY_MAX_FALHAS,
} from './auth-attempt-limiter';

describe('AuthAttemptLimiter', () => {
  let limiter: AuthAttemptLimiter;

  beforeEach(() => {
    fakeRedis = new FakeRedis();
    limiter = new AuthAttemptLimiter({ get: jest.fn() } as any);
    jest
      .spyOn((limiter as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  describe('login', () => {
    it(`bloqueia a conta após ${LOGIN_MAX_FALHAS} falhas na janela`, async () => {
      for (let i = 0; i < LOGIN_MAX_FALHAS - 1; i++) {
        await limiter.registerLoginFailure('Medico@Inexci.com ');
      }
      expect(await limiter.isLoginLocked('medico@inexci.com')).toBe(false);

      await limiter.registerLoginFailure('medico@inexci.com');

      expect(await limiter.isLoginLocked('MEDICO@inexci.com')).toBe(true);
      const chaveBloqueio = [...fakeRedis.ttls.entries()].find(([k]) =>
        k.includes('login:lock:'),
      );
      expect(chaveBloqueio?.[1]).toBe(LOGIN_BLOQUEIO_SEGUNDOS);
    });

    it('login bem-sucedido zera as falhas acumuladas', async () => {
      for (let i = 0; i < LOGIN_MAX_FALHAS - 1; i++) {
        await limiter.registerLoginFailure('a@b.com');
      }
      await limiter.clearLoginFailures('a@b.com');
      await limiter.registerLoginFailure('a@b.com');

      expect(await limiter.isLoginLocked('a@b.com')).toBe(false);
    });

    it('não guarda o e-mail em claro no Redis', async () => {
      await limiter.registerLoginFailure('segredo@clinica.com');
      for (const chave of fakeRedis.store.keys()) {
        expect(chave).not.toContain('segredo@clinica.com');
      }
    });

    it('contas diferentes têm contadores independentes', async () => {
      for (let i = 0; i < LOGIN_MAX_FALHAS; i++) {
        await limiter.registerLoginFailure('a@b.com');
      }
      expect(await limiter.isLoginLocked('a@b.com')).toBe(true);
      expect(await limiter.isLoginLocked('c@d.com')).toBe(false);
    });
  });

  describe('recuperação de senha', () => {
    it(`libera no máximo ${RECOVERY_MAX_EMISSOES} códigos por conta na janela`, async () => {
      const resultados: boolean[] = [];
      for (let i = 0; i < RECOVERY_MAX_EMISSOES + 2; i++) {
        resultados.push(await limiter.tryConsumeRecoveryIssue('user-1'));
      }
      expect(resultados.filter(Boolean)).toHaveLength(RECOVERY_MAX_EMISSOES);
      expect(await limiter.tryConsumeRecoveryIssue('user-2')).toBe(true);
    });

    it(`trava a validação após ${RECOVERY_MAX_FALHAS} falhas acumuladas`, async () => {
      for (let i = 0; i < RECOVERY_MAX_FALHAS - 1; i++) {
        await limiter.registerRecoveryFailure('a@b.com');
      }
      expect(await limiter.isRecoveryValidationLocked('a@b.com')).toBe(false);

      await limiter.registerRecoveryFailure('A@B.com');

      expect(await limiter.isRecoveryValidationLocked('a@b.com')).toBe(true);
    });
  });

  it('fica desligado com NODE_ENV=test, como o throttler global', async () => {
    const emTeste = new AuthAttemptLimiter({
      get: jest.fn((k: string) => (k === 'NODE_ENV' ? 'test' : undefined)),
    } as any);
    for (let i = 0; i < LOGIN_MAX_FALHAS; i++) {
      await emTeste.registerLoginFailure('a@b.com');
    }
    expect(await emTeste.isLoginLocked('a@b.com')).toBe(false);
    expect(fakeRedis.store.size).toBe(0);
  });

  describe('Redis indisponível', () => {
    beforeEach(() => {
      fakeRedis.status = 'connecting';
    });

    it('não bloqueia ninguém (fail-open) e não lança', async () => {
      await expect(limiter.isLoginLocked('a@b.com')).resolves.toBe(false);
      await expect(
        limiter.registerLoginFailure('a@b.com'),
      ).resolves.toBeUndefined();
      await expect(limiter.tryConsumeRecoveryIssue('user-1')).resolves.toBe(
        true,
      );
      await expect(limiter.isRecoveryValidationLocked('a@b.com')).resolves.toBe(
        false,
      );
    });

    it('erro de comando também cai no fallback', async () => {
      fakeRedis.status = 'ready';
      jest.spyOn(fakeRedis, 'exists').mockRejectedValue(new Error('boom'));
      await expect(limiter.isLoginLocked('a@b.com')).resolves.toBe(false);
    });
  });

  describe('MFA', () => {
    it('bloqueia a conta na 5ª falha e avisa que bloqueou', async () => {
      expect(MFA_MAX_FALHAS).toBe(5);
      for (let i = 1; i < MFA_MAX_FALHAS; i++) {
        await expect(limiter.registerMfaFailure('user-1')).resolves.toBe(false);
      }
      await expect(limiter.isMfaLocked('user-1')).resolves.toBe(false);

      await expect(limiter.registerMfaFailure('user-1')).resolves.toBe(true);

      await expect(limiter.isMfaLocked('user-1')).resolves.toBe(true);
      expect(fakeRedis.ttls.get('auth:limit:mfa:lock:user-1')).toBe(
        MFA_BLOQUEIO_SEGUNDOS,
      );
      await expect(limiter.isMfaLocked('user-2')).resolves.toBe(false);
    });

    it('acerto zera o contador', async () => {
      await limiter.registerMfaFailure('user-1');
      await limiter.clearMfaFailures('user-1');
      expect(fakeRedis.store.has('auth:limit:mfa:fail:user-1')).toBe(false);
    });

    it('Redis indisponível não derruba a verificação (fail-open como o login)', async () => {
      fakeRedis.status = 'end';
      await expect(limiter.isMfaLocked('user-1')).resolves.toBe(false);
      await expect(limiter.registerMfaFailure('user-1')).resolves.toBe(false);
    });
  });
});
