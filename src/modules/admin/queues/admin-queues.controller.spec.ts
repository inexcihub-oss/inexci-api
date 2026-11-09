import { AdminQueuesController } from './admin-queues.controller';

describe('AdminQueuesController', () => {
  const service = {
    overview: jest.fn().mockResolvedValue({ queues: [] }),
    listFailed: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    retry: jest.fn().mockResolvedValue({}),
    discard: jest.fn().mockResolvedValue({}),
  };
  const controller = new AdminQueuesController(service as never);
  const admin = { adminId: 'adm-1' } as never;

  beforeEach(() => jest.clearAllMocks());

  it('usa paginação padrão nas falhas', async () => {
    await controller.failed({});
    expect(service.listFailed).toHaveBeenCalledWith({
      queue: undefined,
      limit: 25,
      offset: 0,
    });
  });

  it('repassa fila, job, motivo e admin para as ações', async () => {
    await controller.retry('mail', '7', admin, { reason: 'Motivo válido' });
    expect(service.retry).toHaveBeenCalledWith(
      'mail',
      '7',
      'Motivo válido',
      'adm-1',
    );
    await controller.discard('mail', '8', admin, { reason: 'Outro motivo' });
    expect(service.discard).toHaveBeenCalledWith(
      'mail',
      '8',
      'Outro motivo',
      'adm-1',
    );
  });
});
