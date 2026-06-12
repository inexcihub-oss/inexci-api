import { ServiceUnavailableException } from '@nestjs/common';

import { hashRefreshToken } from 'src/shared/crypto/refresh-token-hash.util';

/**
 * Fake mínimo de IORedis: emula os comandos usados pelo RefreshTokenStore
 * (multi/exec encadeado, eval com a semântica do CONSUME_LUA, smembers) sobre
 * Maps em memória. O `status` é controlável para testar o comportamento
 * fail-closed.
 */
class FakeRedis {
  status: 'ready' | 'connecting' | 'end' = 'ready';
  store = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  /** Relógio (segundos) controlável para testar a janela de graça. */
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

  // Emula o CONSUME_LUA (incluindo a janela de graça): lê tok key, distingue
  // not_found / grace / reused / valid e marca revoked+revokedAt no caminho
  // válido.
  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    graceArg: string,
  ): Promise<string> {
    const raw = this.store.get(key);
    if (!raw) return 'not_found';
    const data = JSON.parse(raw);
    const grace = Number(graceArg);
    if (data.revoked) {
      if (
        data.revokedAt !== undefined &&
        this.clockSeconds - data.revokedAt <= grace
      ) {
        return `grace:${data.userId}`;
      }
      return `reused:${data.userId}`;
    }
    data.revoked = true;
    data.revokedAt = this.clockSeconds;
    this.store.set(key, JSON.stringify(data));
    return `valid:${data.userId}`;
  }
}

let fakeRedis: FakeRedis;

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => fakeRedis),
  };
});

// Import após o mock para que o construtor use o FakeRedis.
import { RefreshTokenStore } from './refresh-token.store';

describe('RefreshTokenStore', () => {
  let store: RefreshTokenStore;
  const configService = { get: jest.fn() } as any;

  beforeEach(() => {
    fakeRedis = new FakeRedis();
    store = new RefreshTokenStore(configService);
  });

  it('issue retorna o token cru e persiste apenas o hash (nunca o cru)', async () => {
    const raw = await store.issue('user-1');

    const hash = hashRefreshToken(raw);
    expect(fakeRedis.store.has(`refresh:tok:${hash}`)).toBe(true);
    // O valor cru nunca aparece em nenhuma chave/valor.
    expect(fakeRedis.store.has(`refresh:tok:${raw}`)).toBe(false);
    for (const value of fakeRedis.store.values()) {
      expect(value).not.toContain(raw);
    }
    // O hash entra no set do usuário.
    expect(await fakeRedis.smembers('refresh:user:user-1')).toContain(hash);
  });

  it('consume de um token válido retorna valid e marca como revogado (rotação)', async () => {
    const raw = await store.issue('user-1');

    const first = await store.consume(raw);
    expect(first).toEqual({ status: 'valid', userId: 'user-1' });
  });

  it('replay dentro da janela de graça é corrida legítima (valid, não reused)', async () => {
    const raw = await store.issue('user-1');
    await store.consume(raw); // rotação inicial

    // Replay imediato (mesmo "agora") → dentro da janela → valid.
    const replay = await store.consume(raw);
    expect(replay).toEqual({ status: 'valid', userId: 'user-1' });
  });

  it('replay fora da janela de graça é reuso (reused)', async () => {
    const raw = await store.issue('user-1');
    await store.consume(raw); // rotação inicial

    // Avança o relógio além da janela de graça (30s).
    fakeRedis.clockSeconds += 31;

    const replay = await store.consume(raw);
    expect(replay).toEqual({ status: 'reused', userId: 'user-1' });
  });

  it('consume de um token inexistente retorna not_found', async () => {
    expect(await store.consume('inexistente')).toEqual({ status: 'not_found' });
  });

  it('revokeAllForUser apaga todos os hashes do usuário', async () => {
    const raw1 = await store.issue('user-1');
    const raw2 = await store.issue('user-1');

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

    await expect(store.issue('user-1')).rejects.toBeInstanceOf(
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
