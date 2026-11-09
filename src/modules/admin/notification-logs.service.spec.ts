import {
  NotificationChannel,
  NotificationSendStatus,
} from 'src/database/entities/notification-send-log.entity';
import { NotificationSendLogRepository } from 'src/database/repositories/notification-send-log.repository';
import { NotificationLogsService } from './notification-logs.service';

describe('NotificationLogsService', () => {
  const repository = { search: jest.fn(), stats: jest.fn() };
  const service = new NotificationLogsService(
    repository as unknown as NotificationSendLogRepository,
  );

  beforeEach(() => jest.clearAllMocks());

  it('mascara o destinatário, sanitiza o erro e não devolve conteúdo da mensagem', async () => {
    repository.search.mockResolvedValue({
      total: 1,
      items: [
        {
          id: 'l-1',
          channel: NotificationChannel.WHATSAPP,
          status: NotificationSendStatus.FAILED,
          to: 'whatsapp:+5511987651234',
          template: 'appointment_scheduled',
          notificationType: 'template',
          direction: 'outbound',
          attempts: 2,
          errorMessage: 'Número +5511987651234 inválido',
          ownerId: 'o-1',
          ownerName: 'Clínica Alfa',
          createdAt: new Date('2026-10-01T10:00:00Z'),
          sentAt: null,
          body: 'Olá Maria, sua consulta',
          subject: 'Consulta de Maria',
        },
      ],
    });

    const result = await service.list({});

    expect(result.total).toBe(1);
    const item = result.items[0];
    expect(item.recipient).toBe('+55 11 9****-1234');
    expect(item.error).toBe('Número *** inválido');
    expect(item.ownerName).toBe('Clínica Alfa');
    expect(Object.keys(item).sort()).toEqual(
      [
        'attempts',
        'channel',
        'createdAt',
        'direction',
        'error',
        'id',
        'notificationType',
        'ownerId',
        'ownerName',
        'recipient',
        'sentAt',
        'status',
        'template',
        'templateLabel',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('Maria,');
    expect(JSON.stringify(result)).not.toContain('987651234');
  });

  it('aplica limite e deslocamento padrão e repassa os filtros', async () => {
    repository.search.mockResolvedValue({ items: [], total: 0 });
    const from = new Date('2026-10-01T03:00:00Z');
    const to = new Date('2026-11-01T03:00:00Z');

    await service.list({
      channel: NotificationChannel.EMAIL,
      status: NotificationSendStatus.SENT,
      ownerId: 'o-1',
      from,
      to,
    });

    expect(repository.search).toHaveBeenCalledWith({
      channel: NotificationChannel.EMAIL,
      status: NotificationSendStatus.SENT,
      ownerId: 'o-1',
      from,
      to,
      limit: 50,
      offset: 0,
    });
  });

  it('stats repassa canal, conta e período', async () => {
    repository.stats.mockResolvedValue([
      { channel: 'email', status: 'sent', count: 3 },
    ]);

    const result = await service.stats({ ownerId: 'o-1' });

    expect(repository.stats).toHaveBeenCalledWith({
      channel: undefined,
      ownerId: 'o-1',
      from: undefined,
      to: undefined,
    });
    expect(result).toEqual([{ channel: 'email', status: 'sent', count: 3 }]);
  });
});
