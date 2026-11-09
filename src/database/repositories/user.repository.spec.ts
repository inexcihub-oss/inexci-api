import { UserRepository } from './user.repository';

describe('UserRepository', () => {
  function buildRepo() {
    const mockRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };
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

  it('findManyByPhones busca as grafias de uma vez, com o mesmo select do perfil, e traz até 2 para detectar ambiguidade', async () => {
    const { repo, mockRepository } = buildRepo();

    await repo.findManyByPhones([
      '11987654321',
      '',
      '11987654321',
      '+5511987654321',
    ]);

    expect(mockRepository.find).toHaveBeenCalledTimes(1);
    const call = mockRepository.find.mock.calls[0][0];
    expect(call.where.phone.value).toEqual(['11987654321', '+5511987654321']);
    expect(call.take).toBe(2);
    expect(call.select).toMatchObject({
      permissions: true,
      aiConsentAcceptedAt: true,
    });
  });

  it('findManyByPhones sem telefone não consulta o banco', async () => {
    const { repo, mockRepository } = buildRepo();

    await expect(repo.findManyByPhones([''])).resolves.toEqual([]);
    expect(mockRepository.find).not.toHaveBeenCalled();
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

  describe('desativação da conta', () => {
    function queryBuilder(raw: unknown) {
      const qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(raw),
        getOne: jest.fn().mockResolvedValue(raw),
      };
      return qb;
    }

    it('isAccountDeactivated lê a marca no dono da conta', async () => {
      const qb = queryBuilder({ deactivatedAt: new Date() });
      const repo = new UserRepository({
        createQueryBuilder: jest.fn(() => qb),
      } as never);

      await expect(repo.isAccountDeactivated('owner-1')).resolves.toBe(true);
      expect(qb.where).toHaveBeenCalledWith('u.id = :ownerId', {
        ownerId: 'owner-1',
      });
    });

    it('isAccountDeactivated é falso sem marca ou sem dono', async () => {
      const semMarca = new UserRepository({
        createQueryBuilder: jest.fn(() =>
          queryBuilder({ deactivatedAt: null }),
        ),
      } as never);
      const semDono = new UserRepository({
        createQueryBuilder: jest.fn(() => queryBuilder(undefined)),
      } as never);

      await expect(semMarca.isAccountDeactivated('o')).resolves.toBe(false);
      await expect(semDono.isAccountDeactivated('o')).resolves.toBe(false);
    });

    it('findSessionUser lê a marca do dono no mesmo findOne, sem consulta extra', async () => {
      const qb = queryBuilder({ deactivatedAt: null });
      const findOne = jest.fn().mockResolvedValue({
        id: 'u-1',
        ownerId: 'owner-1',
        owner: { id: 'owner-1', accountDeactivatedAt: new Date() },
      });
      const createQueryBuilder = jest.fn(() => qb);
      const repo = new UserRepository({ findOne, createQueryBuilder } as never);

      const result = await repo.findSessionUser('u-1');

      expect(result?.accountDeactivated).toBe(true);
      expect(createQueryBuilder).not.toHaveBeenCalled();
      const call = findOne.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'u-1' });
      expect(call.relations).toEqual({ doctorProfile: true, owner: true });
      expect(call.select).toMatchObject({
        permissions: true,
        tokenVersion: true,
        accountDeactivatedAt: true,
        owner: { id: true, accountDeactivatedAt: true },
      });
    });

    it('findSessionUser usa a marca do próprio usuário quando ele é o dono', async () => {
      const createQueryBuilder = jest.fn();
      const repo = new UserRepository({
        findOne: jest.fn().mockResolvedValue({
          id: 'owner-1',
          ownerId: 'owner-1',
          accountDeactivatedAt: new Date(),
          owner: null,
        }),
        createQueryBuilder,
      } as never);

      await expect(repo.findSessionUser('owner-1')).resolves.toMatchObject({
        accountDeactivated: true,
      });
      expect(createQueryBuilder).not.toHaveBeenCalled();
    });

    it('findSessionUser cai na consulta com withDeleted quando o dono não veio no join', async () => {
      const qb = queryBuilder({ deactivatedAt: new Date() });
      const repo = new UserRepository({
        findOne: jest.fn().mockResolvedValue({
          id: 'u-1',
          ownerId: 'owner-1',
          owner: null,
        }),
        createQueryBuilder: jest.fn(() => qb),
      } as never);

      await expect(repo.findSessionUser('u-1')).resolves.toMatchObject({
        accountDeactivated: true,
      });
      expect(qb.withDeleted).toHaveBeenCalled();
    });

    it('findSessionUser devolve null quando o usuário não existe', async () => {
      const repo = new UserRepository({
        findOne: jest.fn().mockResolvedValue(null),
      } as never);

      await expect(repo.findSessionUser('ghost')).resolves.toBeNull();
    });

    it('findAccountMembers inclui membros removidos (soft delete) para derrubar todas as sessões', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const repo = new UserRepository({ find } as never);

      await repo.findAccountMembers('owner-1');

      expect(find).toHaveBeenCalledWith({
        where: { ownerId: 'owner-1' },
        select: { id: true, phone: true },
        withDeleted: true,
      });
    });

    it('lockAccountOwner trava só o dono (id = owner_id) para escrita', async () => {
      const qb = queryBuilder({ id: 'owner-1' });
      const manager = {
        getRepository: jest.fn(() => ({ createQueryBuilder: () => qb })),
      };
      const repo = new UserRepository({} as never);

      await repo.lockAccountOwner('owner-1', manager as never);

      expect(qb.where).toHaveBeenCalledWith(
        'u.id = :ownerId AND u.ownerId = :ownerId',
        { ownerId: 'owner-1' },
      );
      expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('setAccountDeactivation grava data e autor no dono pelo manager', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      const manager = { getRepository: jest.fn(() => ({ update })) };
      const repo = new UserRepository({} as never);
      const at = new Date('2026-10-28T12:00:00Z');

      await repo.setAccountDeactivation(
        'owner-1',
        { at, byId: 'adm-1' },
        manager as never,
      );

      expect(update).toHaveBeenCalledWith(
        { id: 'owner-1' },
        { accountDeactivatedAt: at, accountDeactivatedById: 'adm-1' },
      );
    });
  });
});
