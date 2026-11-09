import { AdminGatewayEventsController } from './admin-gateway-events.controller';

describe('AdminGatewayEventsController', () => {
  const service = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    reprocess: jest.fn().mockResolvedValue({}),
  };
  const controller = new AdminGatewayEventsController(service as never);

  beforeEach(() => jest.clearAllMocks());

  it('lista com filtros e paginação padrão', async () => {
    await controller.list({ ownerId: 'o-1', problems: true });
    expect(service.list).toHaveBeenCalledWith({
      ownerId: 'o-1',
      problems: true,
      limit: 25,
      offset: 0,
    });
  });

  it('reprocessa com o motivo e o admin da sessão', async () => {
    await controller.reprocess('e-1', { adminId: 'adm-1' } as never, {
      reason: 'Stripe voltou',
    });
    expect(service.reprocess).toHaveBeenCalledWith(
      'e-1',
      'Stripe voltou',
      'adm-1',
    );
  });
});
