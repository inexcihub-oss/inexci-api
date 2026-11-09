import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { PlatformAuditAction } from '../entities/platform-audit-log.entity';
import { PlatformAuditLogRepository } from './platform-audit-log.repository';

describe('PlatformAuditLogRepository.search', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let repository: PlatformAuditLogRepository;

  beforeAll(async () => {
    const dataSource = new DataSource({ type: 'postgres', entities: ENTITIES });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const runner = {
      connection: dataSource,
      manager: dataSource.manager,
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params: unknown[] = []) => {
        consultas.push({ sql, params });
        return Promise.resolve({
          records: sql.includes('COUNT') ? [{ cnt: '0' }] : [],
        });
      }),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    repository = new PlatformAuditLogRepository(
      dataSource.getRepository('PlatformAuditLog') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
  });

  function sqlDeBusca(): { sql: string; params: unknown[] } {
    const busca = consultas.find(
      (c) => !c.sql.includes('COUNT') && c.sql.includes('platform_audit_logs'),
    );
    if (!busca) throw new Error('nenhuma consulta de busca executada');
    return busca;
  }

  it('sem filtros ordena por data e id sem estourar', async () => {
    const result = await repository.search({ limit: 50, offset: 0 });

    expect(result).toEqual({ items: [], total: 0 });
    expect(consultas.length).toBeGreaterThan(0);
  });

  it('filtra por targetOwnerId', async () => {
    await repository.search({ targetOwnerId: 'o-1', limit: 10, offset: 0 });

    const { sql, params } = sqlDeBusca();
    expect(sql).toContain('target_owner_id');
    expect(params).toContain('o-1');
  });

  it('filtra pelo administrador autor', async () => {
    await repository.search({ actorAdminId: 'a-1', limit: 10, offset: 0 });

    const { sql, params } = sqlDeBusca();
    expect(sql).toContain('actor_admin_id');
    expect(sql).not.toContain('actor_user_id');
    expect(params).toContain('a-1');
  });

  it('filtra por action', async () => {
    await repository.search({
      action: PlatformAuditAction.COUPON_CREATED,
      limit: 10,
      offset: 0,
    });

    expect(sqlDeBusca().params).toContain(PlatformAuditAction.COUPON_CREATED);
  });

  it('filtra por intervalo from/to', async () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-02-01T00:00:00Z');

    await repository.search({ from, to, limit: 10, offset: 0 });

    const { sql, params } = sqlDeBusca();
    expect(sql).toContain('created_at');
    expect(params).toEqual(expect.arrayContaining([from, to]));
  });

  it('junta autor e alvo em platform_admins, nunca em users', async () => {
    await repository.search({ limit: 10, offset: 0 });

    const { sql } = sqlDeBusca();
    expect(sql).toContain('"platform_admins" "a"');
    expect(sql).toContain('"platform_admins" "t"');
    expect(sql).not.toContain('"users"');
    expect(sql).not.toContain('password_hash');
    expect(sql).not.toContain('mfa_secret');
  });

  it('última execução bem-sucedida por ação usa DISTINCT ON e o nome do autor', async () => {
    const result = await repository.findLastSucceededByAction([
      PlatformAuditAction.CRON_STALE_REQUESTS_TRIGGERED,
      PlatformAuditAction.CRON_WEEKLY_SUMMARY_TRIGGERED,
    ]);

    expect(result.size).toBe(0);
    const consulta = consultas.find((c) => c.sql.includes('DISTINCT ON'));
    expect(consulta).toBeDefined();
    expect(consulta?.sql).toContain('"a"."name"');
    expect(consulta?.params).toEqual(
      expect.arrayContaining([
        PlatformAuditAction.CRON_STALE_REQUESTS_TRIGGERED,
        PlatformAuditAction.CRON_WEEKLY_SUMMARY_TRIGGERED,
        'succeeded',
      ]),
    );
  });

  it('pagina com limit e offset', async () => {
    await repository.search({ limit: 20, offset: 40, targetOwnerId: 'o-1' });

    const { sql } = sqlDeBusca();
    expect(sql).toMatch(/ORDER BY/i);
    expect(sql).toMatch(/LIMIT 20/);
    expect(sql).toMatch(/OFFSET 40/);
  });
});
