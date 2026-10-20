import { ServiceUnavailableException } from '@nestjs/common';

import { hashRefreshToken } from 'src/shared/crypto/refresh-token-hash.util';

class FakeRedis {
  status: 'ready' | 'connecting' | 'end' = 'ready';
  store = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  clockSeconds = Math.floor(Date.now() / 1000);

  connect = jest.fn().mockResolvedValue(undefined);
  disconnect = jest.fn();

  multi() {
    const ops: Array<() => void> = [];
    const builder = {
      set: (key: string, value: string) => {
        ops.push(() => this.store.set(key, value));
        return builder;
      },
      sadd: (key: string, member: string) => {
        ops.push(() => {
          const set = this.sets.get(key) ?? new Set<string>();
          set.add(member);
          this.sets.set(key, set);
        });
        return builder;
      },
      expire: () => {
        ops.push(() => {});
        return builder;
      },
      del: (key: string) => {
        ops.push(() => {
          this.store.delete(key);
          this.sets.delete(key);
        });
        return builder;
      },
      exec: async () => {
        ops.forEach((op) => op());
        return [];
      },
    };
    return builder;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    graceArg: string,
    maxGraceArg: string,
  ): Promise<string> {
    const raw = this.store.get(key);
    if (!raw) return 'not_found';
    const data = JSON.parse(raw);
    const grace = Number(graceArg);
    const maxGrace = Number(maxGraceArg);
    const family = data.familyId ?? '';
    const tv = data.tokenVersion === undefined ? '' : String(data.tokenVersion);
    const suffix = `${data.userId}:${family}:${tv}`;
    if (data.revoked) {
      if (
        data.revokedAt !== undefined &&
        this.clockSeconds - data.revokedAt <= grace
      ) {
        const used = Number(data.graceUsed ?? 0);
        if (used < maxGrace) {
          data.graceUsed = used + 1;
          this.store.set(key, JSON.stringify(data));
          return `grace:${suffix}`;
        }
        return `grace_exhausted:${suffix}`;
      }
      return `reused:${suffix}`;
    }
    data.revoked = true;
    data.revokedAt = this.clockSeconds;
    data.graceUsed = 0;
    this.store.set(key, JSON.stringify(data));
    return `valid:${suffix}`;
  }
}

let fakeRedis: FakeRedis;

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => fakeRedis),
  };
});

import {
  CONSUME_LUA,
  MAX_GRACE_EXCHANGES,
  RefreshTokenStore,
} from './refresh-token.store';

describe('RefreshTokenStore', () => {
  let store: RefreshTokenStore;
  const configService = { get: jest.fn() } as any;

  beforeEach(() => {
    fakeRedis = new FakeRedis();
    store = new RefreshTokenStore(configService);
  });

  it('issue retorna o token cru e persiste apenas o hash (nunca o cru)', async () => {
    const raw = await store.issue('user-1', 0);

    const hash = hashRefreshToken(raw);
    expect(fakeRedis.store.has(`refresh:tok:${hash}`)).toBe(true);
    expect(fakeRedis.store.has(`refresh:tok:${raw}`)).toBe(false);
    for (const value of fakeRedis.store.values()) {
      expect(value).not.toContain(raw);
    }
    expect(await fakeRedis.smembers('refresh:user:user-1')).toContain(hash);
  });

  const familiaDe = (raw: string): string =>
    JSON.parse(fakeRedis.store.get(`refresh:tok:${hashRefreshToken(raw)}`)!)
      .familyId as string;

  it('issue sem família abre uma família nova; com família, herda', async () => {
    const primeiro = await store.issue('user-1', 0);
    const familia = familiaDe(primeiro);
    expect(familia).toEqual(expect.any(String));

    const sucessor = await store.issue('user-1', 0, familia);
    expect(familiaDe(sucessor)).toBe(familia);

    const outroLogin = await store.issue('user-1', 0);
    expect(familiaDe(outroLogin)).not.toBe(familia);
  });

  it('consume de um token válido retorna valid com a família e marca como revogado (rotação)', async () => {
    const raw = await store.issue('user-1', 0, 'fam-1');

    const first = await store.consume(raw);
    expect(first).toEqual({
      status: 'valid',
      userId: 'user-1',
      familyId: 'fam-1',
      tokenVersion: 0,
    });
  });

  it('a primeira reapresentação dentro da janela de graça é corrida legítima (grace, mesma família)', async () => {
    const raw = await store.issue('user-1', 0, 'fam-1');
    await store.consume(raw);

    const replay = await store.consume(raw);
    expect(replay).toEqual({
      status: 'grace',
      userId: 'user-1',
      familyId: 'fam-1',
      tokenVersion: 0,
    });
  });

  it('só permite uma troca de graça por token: a seguinte é recusada sem virar reuso', async () => {
    const raw = await store.issue('user-1', 0, 'fam-1');
    await store.consume(raw);
    for (let i = 0; i < MAX_GRACE_EXCHANGES; i++) {
      await store.consume(raw);
    }

    const terceira = await store.consume(raw);
    expect(terceira).toEqual({
      status: 'grace_exhausted',
      userId: 'user-1',
      familyId: 'fam-1',
      tokenVersion: 0,
    });
  });

  it('replay fora da janela de graça é reuso (reused)', async () => {
    const raw = await store.issue('user-1', 0, 'fam-1');
    await store.consume(raw);

    fakeRedis.clockSeconds += 31;

    const replay = await store.consume(raw);
    expect(replay).toEqual({
      status: 'reused',
      userId: 'user-1',
      familyId: 'fam-1',
      tokenVersion: 0,
    });
  });

  it('registro legado sem família é aceito e devolve familyId nulo', async () => {
    const hash = hashRefreshToken('legado');
    fakeRedis.store.set(
      `refresh:tok:${hash}`,
      JSON.stringify({ userId: 'user-1', createdAt: Date.now() }),
    );

    expect(await store.consume('legado')).toEqual({
      status: 'valid',
      userId: 'user-1',
      familyId: null,
      tokenVersion: null,
    });
  });

  it('guarda a versão de sessão do usuário e a devolve no consume', async () => {
    const raw = await store.issue('user-1', 7, 'fam-1');
    const registro = JSON.parse(
      fakeRedis.store.get(`refresh:tok:${hashRefreshToken(raw)}`)!,
    );
    expect(registro.tokenVersion).toBe(7);

    expect(await store.consume(raw)).toEqual({
      status: 'valid',
      userId: 'user-1',
      familyId: 'fam-1',
      tokenVersion: 7,
    });
  });

  it('o script Lua limita as trocas de graça e propaga a família', () => {
    expect(CONSUME_LUA).toContain('graceUsed');
    expect(CONSUME_LUA).toContain('maxGrace');
    expect(CONSUME_LUA).toContain("'grace_exhausted:'");
    expect(CONSUME_LUA).toContain('data.familyId');
    expect(CONSUME_LUA).toContain('data.tokenVersion');
  });

  it('consume de um token inexistente retorna not_found', async () => {
    expect(await store.consume('inexistente')).toEqual({ status: 'not_found' });
  });

  it('revokeAllForUser apaga todos os hashes do usuário', async () => {
    const raw1 = await store.issue('user-1', 0);
    const raw2 = await store.issue('user-1', 0);

    await store.revokeAllForUser('user-1');

    expect(fakeRedis.store.has(`refresh:tok:${hashRefreshToken(raw1)}`)).toBe(
      false,
    );
    expect(fakeRedis.store.has(`refresh:tok:${hashRefreshToken(raw2)}`)).toBe(
      false,
    );
    expect(await fakeRedis.smembers('refresh:user:user-1')).toEqual([]);
  });

  it('falha fechado (não usa in-memory) quando o Redis não está pronto', async () => {
    fakeRedis.status = 'end';

    await expect(store.issue('user-1', 0)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(store.consume('x')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(store.revokeAllForUser('user-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
