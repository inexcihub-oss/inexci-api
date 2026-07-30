import { UserRole } from 'src/database/entities/user.entity';
import { SurgeryRequestRealtimeService } from './surgery-request-realtime.service';

/**
 * O destinatário do evento de kanban é "todo usuário da conta que enxerga o
 * médico da SC". Esse recorte é o requisito, não um detalhe: um colaborador com
 * acesso ao médico precisa ver a coluna Pendente mudar sem recarregar.
 */
describe('SurgeryRequestRealtimeService', () => {
  const surgeryRequestRepository = {
    findOneSimple: jest.fn(),
    findDistinctActivityUserIds: jest.fn(),
  };
  const userRepository = { findByOwnerId: jest.fn() };
  const notificationsGateway = { emitSurgeryRequestChanged: jest.fn() };
  const accessControlService = { getAccessibleDoctorIds: jest.fn() };

  const build = (gateway?: unknown, access?: unknown) =>
    new SurgeryRequestRealtimeService(
      surgeryRequestRepository as never,
      userRepository as never,
      gateway as never,
      access as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    surgeryRequestRepository.findOneSimple.mockResolvedValue({
      id: 'sc-1',
      ownerId: 'owner-1',
      doctorId: 'doctor-1',
      createdById: 'doctor-1',
    });
    surgeryRequestRepository.findDistinctActivityUserIds.mockResolvedValue([]);
    userRepository.findByOwnerId.mockResolvedValue([
      { id: 'doctor-1', role: UserRole.ADMIN },
      { id: 'colab-com-acesso', role: UserRole.COLLABORATOR },
      { id: 'colab-sem-acesso', role: UserRole.COLLABORATOR },
    ]);
    accessControlService.getAccessibleDoctorIds.mockImplementation(
      (userId: string) =>
        Promise.resolve(
          userId === 'colab-sem-acesso' ? ['outro-medico'] : ['doctor-1'],
        ),
    );
  });

  it('emite para quem tem acesso ao médico e não para os demais', async () => {
    await build(notificationsGateway, accessControlService).broadcastChange(
      'sc-1',
      'created',
      'doctor-1',
    );

    expect(
      notificationsGateway.emitSurgeryRequestChanged,
    ).toHaveBeenCalledTimes(1);
    const [targets, payload] =
      notificationsGateway.emitSurgeryRequestChanged.mock.calls[0];
    expect(targets).toContain('doctor-1');
    expect(targets).toContain('colab-com-acesso');
    expect(targets).not.toContain('colab-sem-acesso');
    expect(payload).toMatchObject({
      surgeryRequestId: 'sc-1',
      action: 'created',
    });
  });

  it('funciona sem ator (é o caso do sweeper)', async () => {
    await build(notificationsGateway, accessControlService).broadcastChange(
      'sc-1',
      'created',
    );

    const [targets] =
      notificationsGateway.emitSurgeryRequestChanged.mock.calls[0];
    expect(targets).toContain('doctor-1');
    expect(targets).toContain('colab-com-acesso');
  });

  it('não explode quando o gateway não está disponível', async () => {
    await expect(
      build(undefined, accessControlService).broadcastChange('sc-1', 'created'),
    ).resolves.toBeUndefined();
    expect(
      notificationsGateway.emitSurgeryRequestChanged,
    ).not.toHaveBeenCalled();
  });

  it('engole falha de leitura para não derrubar quem chamou', async () => {
    surgeryRequestRepository.findOneSimple.mockRejectedValue(
      new Error('banco fora'),
    );

    await expect(
      build(notificationsGateway, accessControlService).broadcastChange(
        'sc-1',
        'created',
      ),
    ).resolves.toBeUndefined();
  });
});
