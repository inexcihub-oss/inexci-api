import { ConfigService } from '@nestjs/config';

const store = new Map<string, string>();

const mockRedisInstance: Record<string, any> = {
  status: 'ready',
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn(() => mockRedisInstance),
  };
});

import { AiRedisService } from './ai-redis.service';

function setupMockImplementations(): void {
  mockRedisInstance.connect = jest.fn().mockResolvedValue(undefined);
  mockRedisInstance.disconnect = jest.fn();
  mockRedisInstance.incr = jest.fn().mockImplementation(async (key: string) => {
    const existing = store.get(key);
    const newVal = existing ? parseInt(existing, 10) + 1 : 1;
    store.set(key, String(newVal));
    return newVal;
  });
  mockRedisInstance.expire = jest.fn().mockResolvedValue(1);
  mockRedisInstance.get = jest.fn().mockImplementation(async (key: string) => {
    return store.get(key) ?? null;
  });
  mockRedisInstance.set = jest
    .fn()
    .mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    });
  mockRedisInstance.del = jest.fn().mockImplementation(async (key: string) => {
    store.delete(key);
    return 1;
  });
}

describe('AiRedisService', () => {
  let service: AiRedisService;
  let configService: ConfigService;

  beforeEach(() => {
    store.clear();
    mockRedisInstance.status = 'ready';
    setupMockImplementations();

    configService = {
      get: jest.fn().mockImplementation((key: string, def?: any) => {
        if (key === 'REDIS_HOST') return 'localhost';
        if (key === 'REDIS_PORT') return 6379;
        return def;
      }),
    } as any;

    service = new AiRedisService(configService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('deve reportar como disponível quando Redis conecta', () => {
    expect(service.isAvailable).toBe(true);
  });

  describe('checkRateLimit', () => {
    it('deve permitir até o máximo de requisições', async () => {
      expect(await service.checkRateLimit('+5511999', 3, 3600)).toBe(true);
      expect(await service.checkRateLimit('+5511999', 3, 3600)).toBe(true);
      expect(await service.checkRateLimit('+5511999', 3, 3600)).toBe(true);
    });

    it('deve bloquear após exceder o limite', async () => {
      await service.checkRateLimit('+5511999', 2, 3600);
      await service.checkRateLimit('+5511999', 2, 3600);
      const result = await service.checkRateLimit('+5511999', 2, 3600);
      expect(result).toBe(false);
    });

    it('deve chamar expire apenas na primeira contagem', async () => {
      await service.checkRateLimit('+5511999', 5, 3600);
      expect(mockRedisInstance.expire).toHaveBeenCalledTimes(1);
      expect(mockRedisInstance.expire).toHaveBeenCalledWith(
        'ai:rl:+5511999',
        3600,
      );

      await service.checkRateLimit('+5511999', 5, 3600);
      expect(mockRedisInstance.expire).toHaveBeenCalledTimes(1);
    });
  });

  describe('cacheGet / cacheSet / cacheDelete', () => {
    it('deve retornar null quando chave não existe', async () => {
      expect(await service.cacheGet('nonexistent')).toBeNull();
    });

    it('deve armazenar e recuperar valores JSON', async () => {
      await service.cacheSet('user:123', { name: 'João' }, 60);
      const result = await service.cacheGet<{ name: string }>('user:123');
      expect(result).toEqual({ name: 'João' });
    });

    it('deve deletar chaves', async () => {
      await service.cacheSet('user:123', { name: 'João' }, 60);
      await service.cacheDelete('user:123');
      expect(await service.cacheGet('user:123')).toBeNull();
    });

    it('deve retornar null para JSON inválido', async () => {
      store.set('ai:bad', 'not-json{');
      expect(await service.cacheGet('bad')).toBeNull();
    });
  });

  describe('setFlag / hasFlag', () => {
    it('deve retornar false quando flag não existe', async () => {
      expect(await service.hasFlag('clear:phone')).toBe(false);
    });

    it('deve setar e verificar flag', async () => {
      await service.setFlag('clear:phone', 300);
      expect(await service.hasFlag('clear:phone')).toBe(true);
    });
  });

  describe('fallback quando Redis indisponível', () => {
    beforeEach(() => {
      (service as any).redis = null;
    });

    it('checkRateLimit deve retornar true (sem bloqueio)', async () => {
      expect(await service.checkRateLimit('+5511999', 1, 3600)).toBe(true);
    });

    it('cacheGet deve retornar null', async () => {
      expect(await service.cacheGet('any')).toBeNull();
    });

    it('cacheSet não deve lançar erro', async () => {
      await expect(service.cacheSet('k', 'v', 60)).resolves.toBeUndefined();
    });

    it('cacheDelete não deve lançar erro', async () => {
      await expect(service.cacheDelete('k')).resolves.toBeUndefined();
    });

    it('hasFlag deve retornar false', async () => {
      expect(await service.hasFlag('any')).toBe(false);
    });

    it('setFlag não deve lançar erro', async () => {
      await expect(service.setFlag('k', 60)).resolves.toBeUndefined();
    });
  });
});
