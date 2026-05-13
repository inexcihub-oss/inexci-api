import { PiiBindingService } from './pii-binding.service';

function makeDeps(overrides: Partial<Record<string, any>> = {}) {
  const piiVault = {
    detectResidualPii: jest.fn().mockReturnValue([]),
    maskLiteralPii: jest.fn().mockReturnValue({ text: '', masked: [] }),
    hashValue: jest.fn().mockReturnValue('hash'),
    serializeSession: jest.fn().mockReturnValue([]),
    restoreSession: jest.fn(),
    ...overrides.piiVault,
  };
  const aiRedis = {
    isAvailable: false,
    cacheGet: jest.fn().mockResolvedValue(null),
    cacheSet: jest.fn().mockResolvedValue(undefined),
    ...overrides.aiRedis,
  };
  const piiRedactionLogRepo = {
    create: jest.fn().mockResolvedValue(undefined),
    ...overrides.piiRedactionLogRepo,
  };
  return { piiVault, aiRedis, piiRedactionLogRepo };
}

describe('PiiBindingService', () => {
  describe('loadPersistedPiiBindings', () => {
    it('retorna null quando Redis não está disponível e não há fallback in-memory', async () => {
      const deps = makeDeps();
      const svc = new PiiBindingService(
        deps.piiVault as any,
        deps.aiRedis as any,
        deps.piiRedactionLogRepo as any,
      );
      const result = await svc.loadPersistedPiiBindings('conv-1');
      expect(result).toBeNull();
    });

    it('carrega bindings do Redis quando disponível e armazenado', async () => {
      const stored = [['key', 'value']] as any;
      const deps = makeDeps({
        aiRedis: {
          isAvailable: true,
          cacheGet: jest.fn().mockResolvedValue(stored),
        },
      });
      const svc = new PiiBindingService(
        deps.piiVault as any,
        deps.aiRedis as any,
        deps.piiRedactionLogRepo as any,
      );
      const result = await svc.loadPersistedPiiBindings('conv-1');
      expect(result).toBe(stored);
    });

    it('usa fallback in-memory quando Redis falha', async () => {
      const stored = [['key', 'val']] as any;
      const deps = makeDeps({
        aiRedis: {
          isAvailable: true,
          cacheGet: jest.fn().mockRejectedValue(new Error('timeout')),
          cacheSet: jest.fn().mockRejectedValue(new Error('timeout')),
        },
        piiVault: {
          serializeSession: jest.fn().mockReturnValue(stored),
        },
      });
      const svc = new PiiBindingService(
        deps.piiVault as any,
        deps.aiRedis as any,
        deps.piiRedactionLogRepo as any,
      );
      // Persiste no fallback in-memory
      await svc.persistPiiBindings('conv-1');
      // Deve recuperar do in-memory
      const result = await svc.loadPersistedPiiBindings('conv-1');
      expect(result).toEqual(stored);
    });
  });

  describe('redactResidualPii', () => {
    it('não modifica mensagens sem PII residual', async () => {
      const deps = makeDeps({
        piiVault: {
          detectResidualPii: jest.fn().mockReturnValue([]),
        },
      });
      const svc = new PiiBindingService(
        deps.piiVault as any,
        deps.aiRedis as any,
        deps.piiRedactionLogRepo as any,
      );
      const messages: any[] = [{ role: 'user', content: 'olá tudo bem' }];
      await svc.redactResidualPii(messages, {
        conversationId: 'conv-1',
        messageSid: 'sid-1',
      });
      expect(messages[0].content).toBe('olá tudo bem');
      expect(deps.piiRedactionLogRepo.create).not.toHaveBeenCalled();
    });

    it('mascara PII residual e registra no log', async () => {
      const deps = makeDeps({
        piiVault: {
          detectResidualPii: jest
            .fn()
            .mockReturnValue([{ category: 'cpf', sample: '123.456.789-09' }]),
          maskLiteralPii: jest.fn().mockReturnValue({
            text: 'CPF: XXX.XXX.XXX-XX',
            masked: [{ category: 'cpf', count: 1 }],
          }),
          hashValue: jest.fn().mockReturnValue('hashed'),
        },
      });
      const svc = new PiiBindingService(
        deps.piiVault as any,
        deps.aiRedis as any,
        deps.piiRedactionLogRepo as any,
      );
      const messages: any[] = [
        { role: 'user', content: 'CPF: 123.456.789-09' },
      ];
      await svc.redactResidualPii(messages, {
        conversationId: 'conv-1',
        messageSid: 'sid-1',
      });
      expect(messages[0].content).toBe('CPF: XXX.XXX.XXX-XX');
      expect(deps.piiRedactionLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'cpf', blocked: false }),
      );
    });
  });
});
