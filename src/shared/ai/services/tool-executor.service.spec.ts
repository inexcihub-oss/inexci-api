import {
  ToolExecutorService,
  temPermissaoParaTool,
} from './tool-executor.service';
import { AiTool, ANY_AUTHENTICATED } from '../tools/tool.interface';
import { ALL_PERMISSIONS, Permission } from '../../permissions';

function makeCall(name: string, args: Record<string, any> = {}) {
  return {
    id: `call-${name}`,
    type: 'function' as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

function buildTool(
  name: string,
  executeFn: jest.Mock,
  cacheable?: AiTool['cacheable'],
): AiTool {
  return {
    name,
    definition: { type: 'function', function: { name, parameters: {} } } as any,
    cacheable,
    requiredPermission: ANY_AUTHENTICATED,
    execute: executeFn,
  };
}

function buildRegistryMock(tools: AiTool[]) {
  const map = new Map(tools.map((t) => [t.name, t]));
  return {
    getTool: (name: string) => map.get(name),
    executeTool: async (name: string, args: Record<string, any>, ctx: any) => {
      const tool = map.get(name);
      if (!tool) return `Ferramenta "${name}" não encontrada.`;
      return tool.execute(args, ctx);
    },
    tools: map,
  };
}

function buildRedisOffline() {
  return {
    isAvailable: false,
    cacheGet: jest.fn().mockResolvedValue(null),
    cacheSet: jest.fn().mockResolvedValue(undefined),
    cacheDelete: jest.fn().mockResolvedValue(undefined),
  };
}

function buildRedisOnline(store: Map<string, string> = new Map()) {
  return {
    get isAvailable() {
      return true;
    },
    cacheGet: jest.fn(async (key: string) => {
      const raw = store.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }),
    cacheSet: jest.fn(async (key: string, value: any, _ttl: number) => {
      store.set(key, JSON.stringify(value));
    }),
    cacheDelete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

const CONTEXT = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doc-1'],
  conversationId: 'conv-1',
  ownerId: 'owner-1',
};

describe('ToolExecutorService (Fase 7 — cache de leitura)', () => {
  describe('buildCacheKey', () => {
    it('gera chave com prefixo, owner, toolName e args serializados', () => {
      const svc = new ToolExecutorService(
        buildRegistryMock([]) as any,
        buildRedisOffline() as any,
      );
      const key = svc.buildCacheKey('owner-1', 'search_tuss_codes', {
        query: 'joelho',
        limit: 10,
      });
      expect(key).toMatch(/^tcache:owner-1:search_tuss_codes:/);
      expect(key).toContain('joelho');
    });

    it('chaves com mesmos args em ordem diferente são idênticas (sort)', () => {
      const svc = new ToolExecutorService(
        buildRegistryMock([]) as any,
        buildRedisOffline() as any,
      );
      const k1 = svc.buildCacheKey('owner-1', 'tool', { b: 2, a: 1 });
      const k2 = svc.buildCacheKey('owner-1', 'tool', { a: 1, b: 2 });
      expect(k1).toBe(k2);
    });

    it('usa "anon" quando ownerId é null', () => {
      const svc = new ToolExecutorService(
        buildRegistryMock([]) as any,
        buildRedisOffline() as any,
      );
      const key = svc.buildCacheKey(null, 'search_cid_codes', { query: 'M17' });
      expect(key).toMatch(/^tcache:anon:search_cid_codes:/);
    });
  });

  describe('cache in-memory (Redis offline)', () => {
    it('cache miss: chama execute e armazena resultado', async () => {
      const executeFn = jest.fn().mockResolvedValue('resultado TUSS');
      const tussToolMock = buildTool('search_tuss_codes', executeFn, {
        ttlSeconds: 3600,
      });
      const svc = new ToolExecutorService(
        buildRegistryMock([tussToolMock]) as any,
        buildRedisOffline() as any,
      );

      const results = await svc.executeMany(
        [makeCall('search_tuss_codes', { query: 'joelho' })],
        CONTEXT,
      );

      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(results[0].output).toBe('resultado TUSS');
    });

    it('cache hit: NÃO chama execute na segunda chamada com mesmos args', async () => {
      const executeFn = jest.fn().mockResolvedValue('resultado TUSS');
      const tussToolMock = buildTool('search_tuss_codes', executeFn, {
        ttlSeconds: 3600,
      });
      const svc = new ToolExecutorService(
        buildRegistryMock([tussToolMock]) as any,
        buildRedisOffline() as any,
      );

      await svc.executeMany(
        [makeCall('search_tuss_codes', { query: 'joelho' })],
        CONTEXT,
      );
      const results = await svc.executeMany(
        [makeCall('search_tuss_codes', { query: 'joelho' })],
        CONTEXT,
      );

      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(results[0].output).toBe('resultado TUSS');
    });

    it('cache miss com args diferentes: chama execute duas vezes', async () => {
      const executeFn = jest
        .fn()
        .mockResolvedValueOnce('joelho')
        .mockResolvedValueOnce('ombro');
      const tussToolMock = buildTool('search_tuss_codes', executeFn, {
        ttlSeconds: 3600,
      });
      const svc = new ToolExecutorService(
        buildRegistryMock([tussToolMock]) as any,
        buildRedisOffline() as any,
      );

      await svc.executeMany(
        [makeCall('search_tuss_codes', { query: 'joelho' })],
        CONTEXT,
      );
      await svc.executeMany(
        [makeCall('search_tuss_codes', { query: 'ombro' })],
        CONTEXT,
      );

      expect(executeFn).toHaveBeenCalledTimes(2);
    });

    it('tool sem cacheable nunca armazena resultado (não cacheable = sempre executa)', async () => {
      const executeFn = jest.fn().mockResolvedValue('lista de pacientes');
      const tool = buildTool('query_patients', executeFn);
      const svc = new ToolExecutorService(
        buildRegistryMock([tool]) as any,
        buildRedisOffline() as any,
      );

      await svc.executeMany([makeCall('query_patients', {})], CONTEXT);
      await svc.executeMany([makeCall('query_patients', {})], CONTEXT);

      expect(executeFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Redis online: usa Redis como primário', () => {
    it('armazena no Redis quando disponível e retorna no hit', async () => {
      const executeFn = jest.fn().mockResolvedValue('resultado TUSS');
      const tussToolMock = buildTool('search_tuss_codes', executeFn, {
        ttlSeconds: 3600,
      });
      const redisStore = new Map<string, string>();
      const redisMock = buildRedisOnline(redisStore);

      const svc = new ToolExecutorService(
        buildRegistryMock([tussToolMock]) as any,
        redisMock as any,
      );

      await svc.executeMany(
        [makeCall('search_tuss_codes', { query: 'joelho' })],
        CONTEXT,
      );

      expect(redisMock.cacheSet).toHaveBeenCalledTimes(1);
      expect(executeFn).toHaveBeenCalledTimes(1);

      await svc.executeMany(
        [makeCall('search_tuss_codes', { query: 'joelho' })],
        CONTEXT,
      );

      expect(redisMock.cacheGet).toHaveBeenCalledTimes(2);
      expect(executeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('permissão de tool', () => {
    function buildGuardedTool(executeFn: jest.Mock): AiTool {
      return {
        ...buildTool('create_surgery_request', executeFn),
        requiredPermission: Permission.SOLICITACOES,
      };
    }

    it('recusa a tool quando falta a permissão exigida', async () => {
      const execute = jest.fn();
      const svc = new ToolExecutorService(
        buildRegistryMock([buildGuardedTool(execute)]) as any,
        buildRedisOffline() as any,
      );

      const [resultado] = await svc.executeMany(
        [makeCall('create_surgery_request', {})],
        { userId: 'u-1', permissions: [Permission.AGENDA] } as never,
      );

      expect(resultado.output).toContain('não tem permissão');
      expect(execute).not.toHaveBeenCalled();
    });

    it('executa quando a permissão está presente', async () => {
      const execute = jest.fn().mockResolvedValue('ok');
      const svc = new ToolExecutorService(
        buildRegistryMock([buildGuardedTool(execute)]) as any,
        buildRedisOffline() as any,
      );

      await svc.executeMany([makeCall('create_surgery_request', {})], {
        userId: 'u-1',
        permissions: [Permission.SOLICITACOES],
      } as never);

      expect(execute).toHaveBeenCalled();
    });

    it('recusa tool sem declaração de permissão em runtime (fail-closed)', async () => {
      const execute = jest.fn();
      const semDeclaracao = {
        ...buildTool('legacy_tool', execute),
        requiredPermission: undefined,
      } as unknown as AiTool;
      const svc = new ToolExecutorService(
        buildRegistryMock([semDeclaracao]) as any,
        buildRedisOffline() as any,
      );

      const [resultado] = await svc.executeMany([makeCall('legacy_tool', {})], {
        userId: 'u-1',
        permissions: [Permission.ADMINISTRACAO],
      } as never);

      expect(resultado.output).toContain('não tem permissão');
      expect(execute).not.toHaveBeenCalled();
    });

    it('responde "não encontrada" para tool fora do registro', async () => {
      const svc = new ToolExecutorService(
        buildRegistryMock([]) as any,
        buildRedisOffline() as any,
      );

      const [resultado] = await svc.executeMany(
        [makeCall('tool_fantasma', {})],
        { userId: 'u-1', permissions: [] } as never,
      );

      expect(resultado.output).toBe(
        'Ferramenta "tool_fantasma" não encontrada.',
      );
    });

    it('executa tool ANY_AUTHENTICATED independentemente das áreas', async () => {
      const execute = jest.fn().mockResolvedValue('ok');
      const svc = new ToolExecutorService(
        buildRegistryMock([buildTool('list_patients', execute)]) as any,
        buildRedisOffline() as any,
      );

      await svc.executeMany([makeCall('list_patients', {})], {
        userId: 'u-1',
        permissions: [],
      } as never);

      expect(execute).toHaveBeenCalled();
    });

    it('recusa quando o contexto não tem `permissions` (fail-closed)', async () => {
      const execute = jest.fn();
      const svc = new ToolExecutorService(
        buildRegistryMock([buildGuardedTool(execute)]) as any,
        buildRedisOffline() as any,
      );

      const [resultado] = await svc.executeMany(
        [makeCall('create_surgery_request', {})],
        { userId: 'u-1' } as never,
      );

      expect(resultado.output).toContain('não tem permissão');
      expect(execute).not.toHaveBeenCalled();
    });

    function buildTransversalTool(executeFn: jest.Mock): AiTool {
      return {
        ...buildTool('hospital_draft_commit', executeFn),
        requiredPermission: ALL_PERMISSIONS,
      };
    }

    it.each(ALL_PERMISSIONS)(
      'executa a tool transversal para quem tem só %s',
      async (permissao) => {
        const execute = jest.fn().mockResolvedValue('ok');
        const svc = new ToolExecutorService(
          buildRegistryMock([buildTransversalTool(execute)]) as any,
          buildRedisOffline() as any,
        );

        await svc.executeMany([makeCall('hospital_draft_commit', {})], {
          userId: 'u-1',
          permissions: [permissao],
        } as never);

        expect(execute).toHaveBeenCalled();
      },
    );

    it('recusa a tool transversal para quem não tem área nenhuma', async () => {
      const execute = jest.fn();
      const svc = new ToolExecutorService(
        buildRegistryMock([buildTransversalTool(execute)]) as any,
        buildRedisOffline() as any,
      );

      const [resultado] = await svc.executeMany(
        [makeCall('hospital_draft_commit', {})],
        { userId: 'u-1', permissions: [] } as never,
      );

      expect(resultado.output).toContain('não tem permissão');
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('temPermissaoParaTool', () => {
    it('libera ANY_AUTHENTICATED mesmo sem área', () => {
      expect(temPermissaoParaTool(ANY_AUTHENTICATED, { permissions: [] })).toBe(
        true,
      );
    });

    it('recusa declaração ausente ou lista vazia (fail-closed)', () => {
      expect(
        temPermissaoParaTool(undefined, {
          permissions: [Permission.ADMINISTRACAO],
        }),
      ).toBe(false);
      expect(
        temPermissaoParaTool([], { permissions: [Permission.ADMINISTRACAO] }),
      ).toBe(false);
    });

    it('exige a permissão única declarada', () => {
      expect(
        temPermissaoParaTool(Permission.SOLICITACOES, {
          permissions: [Permission.AGENDA],
        }),
      ).toBe(false);
      expect(
        temPermissaoParaTool(Permission.SOLICITACOES, {
          permissions: [Permission.SOLICITACOES],
        }),
      ).toBe(true);
    });

    it('trata lista como OR, nunca como AND', () => {
      const exigidas = [Permission.SOLICITACOES, Permission.ATENDIMENTO];
      expect(
        temPermissaoParaTool(exigidas, {
          permissions: [Permission.ATENDIMENTO],
        }),
      ).toBe(true);
      expect(
        temPermissaoParaTool(exigidas, { permissions: [Permission.AGENDA] }),
      ).toBe(false);
    });

    it('é fail-closed sem `permissions` no contexto', () => {
      expect(temPermissaoParaTool(ALL_PERMISSIONS, {})).toBe(false);
    });
  });
});
