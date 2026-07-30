import { AppointmentRepository } from './appointment.repository';
import { AppointmentStatus } from '../entities/appointment.entity';

/**
 * `findAgenda` monta uma janela semiaberta e opcional em cada ponta: a agenda
 * (mês/semana/dia) passa as duas datas, a aba "Próximas" só o início e a aba
 * "Realizadas" nenhuma — filtrando por status e invertendo a ordem.
 */
describe('AppointmentRepository.findAgenda', () => {
  function buildRepo() {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const mockRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue(mockRepository),
    };
    const repo = new AppointmentRepository(dataSource as never);
    return { repo, qb };
  }

  /** Cláusulas passadas ao `andWhere`, em uma string só. */
  const clauses = (qb: { andWhere: jest.Mock }) =>
    qb.andWhere.mock.calls.map((c) => c[0] as string).join(' | ');

  it('aplica as duas pontas da janela como intervalo semiaberto', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAgenda(['d-1'], {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-09-01T00:00:00.000Z'),
      take: 1000,
    });

    expect(clauses(qb)).toContain('appointment.scheduledAt >= :from');
    expect(clauses(qb)).toContain('appointment.scheduledAt < :to');
    expect(qb.orderBy).toHaveBeenCalledWith('appointment.scheduledAt', 'ASC');
    expect(qb.take).toHaveBeenCalledWith(1000);
  });

  it('sem `to`, não impõe teto de data (aba Próximas)', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAgenda(['d-1'], {
      from: new Date('2026-08-01T00:00:00.000Z'),
      statuses: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
      take: 1000,
    });

    expect(clauses(qb)).toContain('appointment.scheduledAt >= :from');
    expect(clauses(qb)).not.toContain(':to');
    expect(qb.andWhere).toHaveBeenCalledWith(
      'appointment.status IN (:...statuses)',
      {
        statuses: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
      },
    );
  });

  it('sem janela nenhuma, filtra só por status e ordena DESC (aba Realizadas)', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAgenda(['d-1'], {
      statuses: [AppointmentStatus.COMPLETED],
      order: 'DESC',
      take: 1000,
    });

    expect(clauses(qb)).not.toContain(':from');
    expect(clauses(qb)).not.toContain(':to');
    expect(qb.orderBy).toHaveBeenCalledWith('appointment.scheduledAt', 'DESC');
  });

  it('ignora lista de status vazia', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAgenda(['d-1'], { statuses: [], take: 1000 });

    expect(clauses(qb)).not.toContain(':...statuses');
  });
});
