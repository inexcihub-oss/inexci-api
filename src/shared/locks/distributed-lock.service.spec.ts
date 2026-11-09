import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DISTRIBUTED_LOCK_DEFAULT_TTL_MS,
  DistributedLockService,
  RELEASE_LUA,
} from './distributed-lock.service';

const mockRedis = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
  status: 'ready',
  set: jest.fn(),
  eval: jest.fn().mockResolvedValue(1),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockRedis),
}));

describe('DistributedLockService', () => {
  const service = new DistributedLockService({
    get: jest.fn((_chave: string, padrao?: unknown) => padrao),
  } as unknown as ConfigService);

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.status = 'ready';
  });

  it('adquire com SET NX e TTL e devolve o token da trava', async () => {
    mockRedis.set.mockResolvedValue('OK');

    const token = await service.acquire('weekly_summary');

    expect(token).toEqual(expect.any(String));
    expect(mockRedis.set).toHaveBeenCalledWith(
      'lock:weekly_summary',
      token,
      'PX',
      DISTRIBUTED_LOCK_DEFAULT_TTL_MS,
      'NX',
    );
  });

  it('aceita um TTL próprio', async () => {
    mockRedis.set.mockResolvedValue('OK');

    await service.acquire('webhook:evt', 1000);

    expect(mockRedis.set).toHaveBeenCalledWith(
      'lock:webhook:evt',
      expect.any(String),
      'PX',
      1000,
      'NX',
    );
  });

  it('devolve null quando a trava já existe', async () => {
    mockRedis.set.mockResolvedValue(null);

    await expect(service.acquire('weekly_summary')).resolves.toBeNull();
  });

  it('recusa com 503 quando o Redis está fora', async () => {
    mockRedis.status = 'reconnecting';

    await expect(service.acquire('weekly_summary')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('só libera a própria trava', async () => {
    await service.release('weekly_summary', 'tok');

    expect(mockRedis.eval).toHaveBeenCalledWith(
      RELEASE_LUA,
      1,
      'lock:weekly_summary',
      'tok',
    );
  });
});
