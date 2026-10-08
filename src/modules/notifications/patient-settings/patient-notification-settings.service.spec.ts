import { PatientNotificationSettingsService } from './patient-notification-settings.service';

describe('PatientNotificationSettingsService', () => {
  const repository = { findOne: jest.fn(), upsert: jest.fn() };
  const accessControlService = { getOwnerId: jest.fn() };
  let service: PatientNotificationSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    accessControlService.getOwnerId.mockResolvedValue('owner-1');
    service = new PatientNotificationSettingsService(
      repository as any,
      accessControlService as any,
    );
  });

  it('conta sem configuração gravada tem todos os avisos ligados', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.getForUser('user-1')).resolves.toEqual({
      appointmentScheduled: true,
      appointmentReminder: true,
      appointmentCancelled: true,
    });
    await expect(
      service.isEnabled('owner-1', 'appointmentReminder'),
    ).resolves.toBe(true);
  });

  it('lê a configuração da conta do usuário, não a do próprio usuário', async () => {
    accessControlService.getOwnerId.mockResolvedValue('owner-9');
    repository.findOne.mockResolvedValue({
      ownerId: 'owner-9',
      appointmentScheduled: true,
      appointmentReminder: false,
      appointmentCancelled: true,
    });

    const view = await service.getForUser('colaborador-1');

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { ownerId: 'owner-9' },
    });
    expect(view.appointmentReminder).toBe(false);
  });

  it('isEnabled respeita o aviso desligado', async () => {
    repository.findOne.mockResolvedValue({
      ownerId: 'owner-1',
      appointmentScheduled: false,
      appointmentReminder: true,
      appointmentCancelled: true,
    });

    await expect(
      service.isEnabled('owner-1', 'appointmentScheduled'),
    ).resolves.toBe(false);
    await expect(
      service.isEnabled('owner-1', 'appointmentCancelled'),
    ).resolves.toBe(true);
  });

  it('grava só os campos booleanos enviados, chaveado pela conta', async () => {
    repository.findOne.mockResolvedValue(null);

    await service.updateForUser('user-1', {
      appointmentReminder: false,
      // Campo estranho que escapasse da validação não chega ao banco.
      ...({ ownerId: 'outra-conta' } as object),
    });

    expect(repository.upsert).toHaveBeenCalledWith(
      { ownerId: 'owner-1', appointmentReminder: false },
      ['ownerId'],
    );
  });

  it('corpo vazio não grava nada', async () => {
    repository.findOne.mockResolvedValue(null);

    await service.updateForUser('user-1', {});

    expect(repository.upsert).not.toHaveBeenCalled();
  });
});
