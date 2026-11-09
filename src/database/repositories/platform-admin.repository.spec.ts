import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { PlatformAdminStatus } from '../entities/platform-admin.entity';
import { PlatformAdminRepository } from './platform-admin.repository';

describe('PlatformAdminRepository', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let respostas: unknown[] = [];
  let repository: PlatformAdminRepository;

  beforeAll(async () => {
    const dataSource = new DataSource({ type: 'postgres', entities: ENTITIES });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const runner = {
      connection: dataSource,
      manager: dataSource.manager,
      isTransactionActive: false,
      broadcaster: {
        broadcast: jest.fn(),
        broadcastLoadEventsForAll: jest.fn(),
      },
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params: unknown[] = []) => {
        consultas.push({ sql, params });
        return Promise.resolve(
          respostas.shift() ?? { records: [], affected: 0 },
        );
      }),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    repository = new PlatformAdminRepository(
      dataSource.getRepository('PlatformAdmin') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
    respostas = [];
  });

  it('login busca por e-mail sem diferenciar maiúsculas e traz o hash da senha', async () => {
    await repository.findForLogin('Ana@Inexci.com');

    const { sql, params } = consultas[0];
    expect(sql).toContain('lower("a"."email") = lower($1)');
    expect(sql).toContain('"a"."password_hash"');
    expect(sql).not.toContain('mfa_secret');
    expect(params).toEqual(['Ana@Inexci.com']);
  });

  it('a sessão não carrega senha nem segredos de MFA', async () => {
    await repository.findSession('a1');

    const { sql } = consultas[0];
    expect(sql).not.toContain('password_hash');
    expect(sql).not.toContain('mfa_secret');
    expect(sql).not.toContain('invite_token_hash');
    expect(sql).toContain('token_version');
  });

  it('aceite do convite é condicional: pendente, hash igual e não expirado', async () => {
    respostas = [{ records: [], affected: 1 }];

    const ok = await repository.acceptInvite('a1', 'h'.repeat(64), 'bcrypt');

    const { sql, params } = consultas[0];
    expect(sql).toContain('UPDATE "platform_admins"');
    expect(sql).toContain('AND "status" = $');
    expect(sql).toContain('AND "invite_token_hash" = $');
    expect(sql).toContain('"invite_expires_at" > now()');
    expect(sql).toContain('"token_version" = "token_version" + 1');
    expect(params).toEqual(
      expect.arrayContaining([
        'bcrypt',
        PlatformAdminStatus.ACTIVE,
        PlatformAdminStatus.PENDING,
        'h'.repeat(64),
        'a1',
      ]),
    );
    expect(ok).toBe(true);
  });

  it('anti-replay do TOTP só aceita passo maior que o último usado', async () => {
    respostas = [{ records: [], affected: 0 }];

    const ok = await repository.consumeMfaStep('a1', 123);

    expect(consultas[0].sql).toContain(
      '("mfa_last_used_step" IS NULL OR "mfa_last_used_step" < $',
    );
    expect(ok).toBe(false);
  });

  it('último acesso só grava de 5 em 5 minutos', async () => {
    await repository.touchLastSeen('a1');

    expect(consultas[0].sql).toContain("interval '5 minutes'");
  });
});
