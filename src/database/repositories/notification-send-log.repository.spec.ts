import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import {
  NotificationChannel,
  NotificationSendStatus,
} from '../entities/notification-send-log.entity';
import { NotificationSendLogRepository } from './notification-send-log.repository';

describe('NotificationSendLogRepository', () => {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let repository: NotificationSendLogRepository;

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
          records: sql.includes('COUNT(') ? [{ cnt: '0' }] : [],
        });
      }),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    repository = new NotificationSendLogRepository(
      dataSource.getRepository('NotificationSendLog') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
  });

  it('search seleciona só colunas explícitas, sem body nem subject', async () => {
    const result = await repository.search({
      channel: NotificationChannel.EMAIL,
      status: NotificationSendStatus.FAILED,
      ownerId: '11111111-1111-4111-8111-111111111111',
      from: new Date('2026-10-01T03:00:00Z'),
      to: new Date('2026-11-01T03:00:00Z'),
      limit: 25,
      offset: 50,
    });

    expect(result).toEqual({ items: [], total: 0 });
    const busca = consultas.find(
      (c) =>
        !c.sql.includes('COUNT(') && c.sql.includes('notification_send_logs'),
    );
    expect(busca).toBeDefined();
    const sql = busca!.sql;
    expect(sql).not.toMatch(/"l"\."body"/);
    expect(sql).not.toMatch(/"l"\."subject"/);
    expect(sql).toContain('"o"."name"');
    expect(sql).toContain('ORDER BY');
  });

  it('stats agrupa por canal e situação com os filtros', async () => {
    await repository.stats({
      ownerId: '11111111-1111-4111-8111-111111111111',
      channel: NotificationChannel.WHATSAPP,
    });

    const q = consultas.find((c) => c.sql.includes('GROUP BY'));
    expect(q).toBeDefined();
    expect(q!.sql).toContain('"l"."owner_id" = $');
    expect(q!.sql).toContain('"l"."channel" = $');
  });
});
