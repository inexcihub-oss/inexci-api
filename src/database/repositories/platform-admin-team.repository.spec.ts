import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { PlatformAdminStatus } from '../entities/platform-admin.entity';
import { PlatformAdminTeamRepository } from './platform-admin-team.repository';

describe('PlatformAdminTeamRepository', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let respostas: unknown[][] = [];
  let repository: PlatformAdminTeamRepository;

  beforeAll(async () => {
    const dataSource = new DataSource({ type: 'postgres', entities: ENTITIES });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const runner = {
      connection: dataSource,
      manager: dataSource.manager,
      isTransactionActive: true,
      broadcaster: {
        broadcast: jest.fn(),
        broadcastLoadEventsForAll: jest.fn(),
      },
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params: unknown[] = []) => {
        consultas.push({ sql, params });
        return Promise.resolve({ records: respostas.shift() ?? [] });
      }),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    jest
      .spyOn(dataSource.manager, 'transaction')
      .mockImplementation(((cb: (m: unknown) => unknown) =>
        cb(dataSource.manager)) as never);
    repository = new PlatformAdminTeamRepository(
      dataSource.getRepository('PlatformAdmin') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
    respostas = [];
  });

  const invite = {
    inviteTokenHash: 'a'.repeat(64),
    inviteExpiresAt: new Date('2026-11-01T00:00:00Z'),
  };

  it('lista a equipe em platform_admins com o nome de quem convidou', async () => {
    respostas = [
      [
        {
          id: 'a1',
          name: 'Bia',
          email: 'b@x.com',
          status: 'active',
          mfa_enabled_at: new Date(),
          last_seen_at: null,
          created_at: new Date(),
          created_by_id: 'a0',
          created_by_name: 'Ana',
        },
      ],
    ];

    const rows = await repository.listTeam();

    const { sql } = consultas[0];
    expect(sql).toContain('FROM "platform_admins" "a"');
    expect(sql).toContain('LEFT JOIN "platform_admins" "c"');
    expect(sql).not.toContain('"users"');
    expect(sql).not.toContain('password_hash');
    expect(sql).not.toContain('mfa_secret');
    expect(sql).toContain('ORDER BY "a"."created_at" ASC');
    expect(rows[0]).toMatchObject({
      mfaEnabled: true,
      createdById: 'a0',
      createdByName: 'Ana',
      lastSeenAt: null,
    });
  });

  it('revoga com FOR UPDATE, inativa e incrementa o token_version', async () => {
    respostas = [
      [
        { a_id: 'a', a_status: PlatformAdminStatus.ACTIVE },
        { a_id: 'b', a_status: PlatformAdminStatus.ACTIVE },
      ],
    ];

    const outcome = await repository.revokeKeepingOneActive('a');

    expect(consultas[0].sql).toContain('FOR UPDATE');
    expect(consultas[1].sql).toContain('UPDATE "platform_admins"');
    expect(consultas[1].sql).toContain('"token_version" = "token_version" + 1');
    expect(consultas[1].params).toEqual(
      expect.arrayContaining([PlatformAdminStatus.INACTIVE, 'a']),
    );
    expect(outcome).toEqual({
      result: 'revoked',
      before: { status: PlatformAdminStatus.ACTIVE },
    });
  });

  it('recusa o último administrador ativo sem escrever', async () => {
    respostas = [
      [
        { a_id: 'a', a_status: PlatformAdminStatus.ACTIVE },
        { a_id: 'b', a_status: PlatformAdminStatus.INACTIVE },
      ],
    ];

    const outcome = await repository.revokeKeepingOneActive('a');

    expect(outcome).toEqual({ result: 'last_active_admin' });
    expect(consultas).toHaveLength(1);
  });

  it('permite revogar convite pendente mesmo sem outro ativo', async () => {
    respostas = [[{ a_id: 'a', a_status: PlatformAdminStatus.PENDING }]];

    const outcome = await repository.revokeKeepingOneActive('a');

    expect(outcome.result).toBe('revoked');
  });

  it('quem já está inativo não é revogado de novo', async () => {
    respostas = [
      [
        { a_id: 'a', a_status: PlatformAdminStatus.INACTIVE },
        { a_id: 'b', a_status: PlatformAdminStatus.ACTIVE },
      ],
    ];

    expect(await repository.revokeKeepingOneActive('a')).toEqual({
      result: 'already_inactive',
    });
    expect(consultas).toHaveLength(1);
  });

  it('alvo inexistente vira not_found', async () => {
    respostas = [[{ a_id: 'b', a_status: PlatformAdminStatus.ACTIVE }]];

    expect(await repository.revokeKeepingOneActive('a')).toEqual({
      result: 'not_found',
    });
    expect(consultas).toHaveLength(1);
  });

  it('redefinir acesso zera senha e MFA, volta a pending e grava o convite', async () => {
    respostas = [
      [
        {
          a_id: 'a',
          a_name: 'Bia',
          a_email: 'b@x.com',
          a_status: PlatformAdminStatus.INACTIVE,
          a_mfa_enabled_at: new Date(),
        },
      ],
    ];

    const outcome = await repository.resetAccess('a', invite);

    expect(consultas[0].sql).toContain('FOR UPDATE');
    const update = consultas[1];
    expect(update.sql).toContain('UPDATE "platform_admins"');
    expect(update.sql).toContain('"password_hash" = $');
    expect(update.sql).toContain('"mfa_secret" = $');
    expect(update.sql).toContain('"mfa_enabled_at" = $');
    expect(update.sql).toContain('"token_version" = "token_version" + 1');
    expect(update.params).toEqual(
      expect.arrayContaining([
        PlatformAdminStatus.PENDING,
        invite.inviteTokenHash,
        invite.inviteExpiresAt,
        'a',
      ]),
    );
    expect(outcome).toMatchObject({
      result: 'reset',
      name: 'Bia',
      email: 'b@x.com',
      before: { status: PlatformAdminStatus.INACTIVE, mfaEnabled: true },
    });
  });

  it('redefinir alvo inexistente vira not_found sem escrever', async () => {
    respostas = [[]];

    expect(await repository.resetAccess('a', invite)).toEqual({
      result: 'not_found',
    });
    expect(consultas).toHaveLength(1);
  });
});
