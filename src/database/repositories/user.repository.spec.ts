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
});
