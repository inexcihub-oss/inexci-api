import { UserRepository } from './user.repository';

describe('UserRepository', () => {
  function buildRepo() {
    const mockRepository = { findOne: jest.fn().mockResolvedValue(null) };
    const repo = new UserRepository(mockRepository as never);
    return { repo, mockRepository };
  }

  it('findOneByPhone consulta com select que inclui `permissions`', async () => {
    const { repo, mockRepository } = buildRepo();

    await repo.findOneByPhone('+5511999999999');

    expect(mockRepository.findOne).toHaveBeenCalledTimes(1);
    const call = mockRepository.findOne.mock.calls[0][0];
    expect(call.where).toEqual({ phone: '+5511999999999' });
    expect(call.select).toMatchObject({ permissions: true });
  });

  it('findOne (genérico) NÃO inclui `permissions` no select', async () => {
    const { repo, mockRepository } = buildRepo();

    await repo.findOne({ id: 'user-1' });

    const call = mockRepository.findOne.mock.calls[0][0];
    expect(call.select).not.toHaveProperty('permissions');
  });

  it('findOneWithProfile inclui `permissions` no select', async () => {
    const { repo, mockRepository } = buildRepo();

    await repo.findOneWithProfile({ id: 'user-1' });

    const call = mockRepository.findOne.mock.calls[0][0];
    expect(call.select).toMatchObject({ permissions: true });
  });

  it('findOneWithProfile inclui onboardingState no select', async () => {
    const { repo, mockRepository } = buildRepo();

    await repo.findOneWithProfile({ id: 'user-1' });

    const call = mockRepository.findOne.mock.calls[0][0];
    expect(call.select).toMatchObject({ onboardingState: true });
  });

  it('findMany não traz CPF, gênero nem nascimento', async () => {
    const mockRepository = { find: jest.fn().mockResolvedValue([]) };
    const repo = new UserRepository(mockRepository as never);

    await repo.findMany({ ownerId: 'dono-1' }, 0, 20);

    const { select } = mockRepository.find.mock.calls[0][0];
    for (const campo of ['cpf', 'gender', 'birthDate']) {
      expect(select).not.toHaveProperty(campo);
    }
    expect(select).toMatchObject({
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    });
  });

  describe('avisos ao paciente (patient_notification_settings)', () => {
    it('conta sem configuração gravada fica com tudo ligado', async () => {
      const { repo, mockRepository } = buildRepo();
      mockRepository.findOne.mockResolvedValue({
        id: 'dono',
        patientNotificationSettings: null,
      });

      await expect(
        repo.getPatientNotificationSettings('dono'),
      ).resolves.toEqual({
        appointmentScheduled: true,
        appointmentReminder: true,
        appointmentCancelled: true,
      });
      const call = mockRepository.findOne.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'dono' });
      expect(call.select).toMatchObject({ patientNotificationSettings: true });
    });

    it('isPatientNotificationEnabled respeita o que foi desligado', async () => {
      const { repo, mockRepository } = buildRepo();
      mockRepository.findOne.mockResolvedValue({
        id: 'dono',
        patientNotificationSettings: { appointmentReminder: false },
      });

      await expect(
        repo.isPatientNotificationEnabled('dono', 'appointmentReminder'),
      ).resolves.toBe(false);
      await expect(
        repo.isPatientNotificationEnabled('dono', 'appointmentCancelled'),
      ).resolves.toBe(true);
    });

    it('update mescla com o atual e grava o objeto completo', async () => {
      const mockRepository = {
        findOne: jest.fn().mockResolvedValue({
          id: 'dono',
          patientNotificationSettings: { appointmentScheduled: false },
        }),
        update: jest.fn().mockResolvedValue(undefined),
      };
      const repo = new UserRepository(mockRepository as never);

      const result = await repo.updatePatientNotificationSettings('dono', {
        appointmentCancelled: false,
      });

      const esperado = {
        appointmentScheduled: false,
        appointmentReminder: true,
        appointmentCancelled: false,
      };
      expect(result).toEqual(esperado);
      expect(mockRepository.update).toHaveBeenCalledWith('dono', {
        patientNotificationSettings: esperado,
      });
    });
  });
});
