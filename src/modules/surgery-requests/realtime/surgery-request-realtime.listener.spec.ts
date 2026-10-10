import { SurgeryRequestRealtimeListener } from './surgery-request-realtime.listener';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

describe('SurgeryRequestRealtimeListener', () => {
  const realtime = { broadcastChange: jest.fn().mockResolvedValue(undefined) };
  const listener = new SurgeryRequestRealtimeListener(realtime as never);

  beforeEach(() => jest.clearAllMocks());

  it('mudança de status (inclusive via IA) atualiza o kanban como status-updated', async () => {
    await listener.handleStatusChanged({
      surgeryRequestId: 'sc-1',
      from: SurgeryRequestStatus.PENDING,
      to: SurgeryRequestStatus.SENT,
      actorId: 'user-1',
    });

    expect(realtime.broadcastChange).toHaveBeenCalledWith(
      'sc-1',
      'status-updated',
      'user-1',
    );
  });

  it('alteração sem autor (resposta do paciente) vira updated sem actor', async () => {
    await listener.handleUpdated({ surgeryRequestId: 'sc-1', actorId: null });

    expect(realtime.broadcastChange).toHaveBeenCalledWith(
      'sc-1',
      'updated',
      undefined,
    );
  });
});
