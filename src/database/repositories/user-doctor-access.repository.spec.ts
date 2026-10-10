import { UserDoctorAccessRepository } from './user-doctor-access.repository';
import { UserDoctorAccessStatus } from '../entities/user-doctor-access.entity';

describe('UserDoctorAccessRepository.replaceDoctorsForUser', () => {
  function build(existentes: Array<Record<string, unknown>>) {
    const save = jest.fn((x) => Promise.resolve(x));
    const find = jest
      .fn()
      .mockResolvedValueOnce(existentes)
      .mockResolvedValueOnce(['final']);
    const create = jest.fn((x) => x);
    const transaction = jest.fn((cb) =>
      cb({ getRepository: () => ({ find, save, create }) }),
    );
    const repo = new UserDoctorAccessRepository({
      getRepository: () => ({ manager: { transaction } }),
    } as never);
    return { repo, save, create, transaction };
  }

  it('desativa os que saíram, reativa e cria os da lista — numa transação', async () => {
    const { repo, save, create, transaction } = build([
      { doctorUserId: 'saiu', status: UserDoctorAccessStatus.ACTIVE },
      { doctorUserId: 'volta', status: UserDoctorAccessStatus.INACTIVE },
    ]);

    const result = await repo.replaceDoctorsForUser(
      'u1',
      ['volta', 'novo'],
      'admin',
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        doctorUserId: 'saiu',
        status: UserDoctorAccessStatus.INACTIVE,
      }),
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        doctorUserId: 'volta',
        status: UserDoctorAccessStatus.ACTIVE,
        createdById: 'admin',
      }),
    );
    expect(create).toHaveBeenCalledWith({
      userId: 'u1',
      doctorUserId: 'novo',
      status: UserDoctorAccessStatus.ACTIVE,
      createdById: 'admin',
    });
    expect(result).toEqual(['final']);
  });

  it('não regrava vínculo que já estava inativo e continua fora', async () => {
    const { repo, save } = build([
      { doctorUserId: 'velho', status: UserDoctorAccessStatus.INACTIVE },
    ]);

    await repo.replaceDoctorsForUser('u1', [], 'admin');

    expect(save).not.toHaveBeenCalled();
  });
});
