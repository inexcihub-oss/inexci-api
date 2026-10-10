import { buildNotificationTools } from './notification.tools';
import { parseToolResult } from './tool-result';
import { ToolContext } from './tool.interface';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';

const context: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

describe('send_notification', () => {
  const surgeryRequestRepo = { findOneSimple: jest.fn() };
  const notificationService = { notify: jest.fn() };
  const activityRepo = { create: jest.fn() };
  const [tool] = buildNotificationTools(
    surgeryRequestRepo as any,
    notificationService as any,
    activityRepo as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    surgeryRequestRepo.findOneSimple.mockResolvedValue({
      id: 'req-1',
      protocol: '0042',
      doctorId: 'doctor-1',
      status: SurgeryRequestStatus.SCHEDULED,
    });
  });

  it('sem confirm devolve envelope pending_confirmation', async () => {
    const parsed = parseToolResult(
      await tool.execute({ surgeryRequestId: 'SC-0042' }, context),
    );

    expect(parsed?.status).toBe('pending_confirmation');
    expect(parsed?.pending_confirmation).toEqual(
      expect.objectContaining({
        tool: 'send_notification',
        args: expect.objectContaining({ confirm: true }),
      }),
    );
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('regressão: envia com o template do status (antes ia `{}` e o service recusava)', async () => {
    const parsed = parseToolResult(
      await tool.execute(
        { surgeryRequestId: 'SC-0042', confirm: true },
        context,
      ),
    );

    expect(notificationService.notify).toHaveBeenCalledWith(
      'req-1',
      { template: 'surgery-scheduled' },
      'user-1',
    );
    expect(activityRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '[WhatsApp IA] Notificação de status enviada.',
      }),
    );
    expect(parsed?.status).toBe('ok');
  });

  it('bloqueia status sem notificação de atualização', async () => {
    surgeryRequestRepo.findOneSimple.mockResolvedValue({
      id: 'req-1',
      protocol: '0042',
      doctorId: 'doctor-1',
      status: SurgeryRequestStatus.PENDING,
    });

    const parsed = parseToolResult(
      await tool.execute(
        { surgeryRequestId: 'SC-0042', confirm: true },
        context,
      ),
    );

    expect(parsed?.status).toBe('blocked');
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('nega SC de médico inacessível', async () => {
    surgeryRequestRepo.findOneSimple.mockResolvedValue({
      id: 'req-1',
      protocol: '0042',
      doctorId: 'outro',
      status: SurgeryRequestStatus.SCHEDULED,
    });

    const parsed = parseToolResult(
      await tool.execute(
        { surgeryRequestId: 'SC-0042', confirm: true },
        context,
      ),
    );

    expect(parsed?.status).toBe('blocked');
    expect(parsed?.message).toMatch(/permissão/);
  });
});
