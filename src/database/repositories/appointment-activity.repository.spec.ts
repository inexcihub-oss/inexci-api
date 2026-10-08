import { AppointmentActivityRepository } from './appointment-activity.repository';

describe('AppointmentActivityRepository.findByAppointment', () => {
  const qb = {
    leftJoin: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
  };
  const repo = new AppointmentActivityRepository({
    getRepository: () => ({ createQueryBuilder: () => qb, metadata: {} }),
  } as any);

  beforeEach(() => {
    for (const fn of [qb.leftJoin, qb.addSelect, qb.where, qb.orderBy]) {
      fn.mockReturnValue(qb);
    }
  });

  it('traz de quem fez só id e nome, da mais antiga para a mais recente', async () => {
    await repo.findByAppointment('a-1');

    expect(qb.leftJoin).toHaveBeenCalledWith('activity.user', 'user');
    expect(qb.addSelect).toHaveBeenCalledWith(['user.id', 'user.name']);
    expect(qb.where).toHaveBeenCalledWith(
      'activity.appointmentId = :appointmentId',
      { appointmentId: 'a-1' },
    );
    expect(qb.orderBy).toHaveBeenCalledWith('activity.createdAt', 'ASC');
  });
});
