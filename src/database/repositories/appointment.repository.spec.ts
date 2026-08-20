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
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
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

    await repo.findAgenda('owner-1', ['d-1'], {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-09-01T00:00:00.000Z'),
      take: 1000,
    });

    expect(clauses(qb)).toContain('appointment.scheduledAt >= :from');
    expect(clauses(qb)).toContain('appointment.scheduledAt < :to');
    expect(qb.orderBy).toHaveBeenCalledWith('appointment.scheduledAt', 'ASC');
    expect(qb.take).toHaveBeenCalledWith(1000);
  });

  it('escopa sempre por clínica, além dos médicos acessíveis', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAgenda('owner-1', ['d-1'], { take: 1000 });

    expect(qb.where).toHaveBeenCalledWith('appointment.ownerId = :ownerId', {
      ownerId: 'owner-1',
    });
    expect(clauses(qb)).toContain('appointment.doctorId IN (:...doctorIds)');
  });

  it('sem `to`, não impõe teto de data (aba Próximas)', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAgenda('owner-1', ['d-1'], {
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

    await repo.findAgenda('owner-1', ['d-1'], {
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

    await repo.findAgenda('owner-1', ['d-1'], { statuses: [], take: 1000 });

    expect(clauses(qb)).not.toContain(':...statuses');
  });

  // D-15: `getManyAndCount` aplica o `take` só às linhas — a contagem é a do
  // recorte inteiro. Com `getMany` + `records.length`, o `total` era o próprio
  // teto e o corte ficava indistinguível de uma lista completa.
  it('devolve a contagem total do recorte, independente do teto da página', async () => {
    const { repo, qb } = buildRepo();
    qb.getManyAndCount.mockResolvedValue([[{ id: 'a-1' }], 1103]);

    const resultado = await repo.findAgenda('owner-1', ['d-1'], {
      statuses: [AppointmentStatus.COMPLETED],
      order: 'DESC',
      take: 1000,
    });

    expect(qb.take).toHaveBeenCalledWith(1000);
    expect(qb.getManyAndCount).toHaveBeenCalled();
    expect(qb.getMany).not.toHaveBeenCalled();
    expect(resultado).toEqual({ records: [{ id: 'a-1' }], total: 1103 });
  });

  // A agenda é liberada por `Permission.AGENDA`, que não implica acesso ao
  // prontuário. Trazer o paciente inteiro entregava CPF, endereço, nascimento
  // e `medicalNotes` de todo paciente da janela a quem só marca consulta — e o
  // frontend descarta tudo menos o nome (`mapAppointment`).
  it('traz do paciente apenas id e nome', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAgenda('owner-1', ['d-1'], { take: 1000 });

    expect(qb.leftJoinAndSelect).not.toHaveBeenCalled();
    expect(qb.leftJoin).toHaveBeenCalledWith(
      'appointment.patient',
      'patient',
      'patient.deleted_at IS NULL',
    );
    expect(qb.addSelect).toHaveBeenCalledWith(['patient.id', 'patient.name']);
  });
});

describe('AppointmentRepository.findByPatient', () => {
  function buildRepo() {
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      }),
    };
    return { repo: new AppointmentRepository(dataSource as never), qb };
  }

  // Mesmo motivo do `findAgenda`: o histórico do paciente alimenta a aba
  // "Consultas", que mostra data, tipo e status — nunca os dados cadastrais.
  it('traz do paciente apenas id e nome', async () => {
    const { repo, qb } = buildRepo();

    await repo.findByPatient('owner-1', ['d-1'], 'p-1');

    expect(qb.leftJoinAndSelect).not.toHaveBeenCalled();
    expect(qb.leftJoin).toHaveBeenCalledWith(
      'appointment.patient',
      'patient',
      'patient.deleted_at IS NULL',
    );
    expect(qb.addSelect).toHaveBeenCalledWith(['patient.id', 'patient.name']);
  });
});

/**
 * O TypeORM aplica o filtro de soft delete também às relações: sem
 * `withDeleted()`, a consulta de uma clínica excluída voltaria com
 * `clinic: null` — exatamente o que o soft delete deveria evitar. E como
 * `withDeleted()` vale para a query inteira, o filtro do root precisa voltar
 * na mão, senão consultas excluídas apareceriam na agenda.
 */
describe('AppointmentRepository — join da clínica', () => {
  const qb = {
    leftJoin: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    take: jest.fn(),
    withDeleted: jest.fn(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
  };

  const repository = {
    createQueryBuilder: jest.fn(() => qb),
    metadata: { deleteDateColumn: {} },
  };

  const dataSource = { getRepository: () => repository } as any;
  let repo: AppointmentRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    // Encadeamento do query builder: todo método fluente devolve o próprio qb.
    // Os terminais (`getManyAndCount`, `getMany`, `getOne`) ficam de fora — se
    // devolvessem o qb, o `await` nunca resolveria.
    qb.getManyAndCount.mockResolvedValue([[], 0]);
    qb.getMany.mockResolvedValue([]);
    qb.getOne.mockResolvedValue(null);
    qb.leftJoin.mockReturnValue(qb);
    qb.addSelect.mockReturnValue(qb);
    qb.where.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    qb.orderBy.mockReturnValue(qb);
    qb.take.mockReturnValue(qb);
    qb.withDeleted.mockReturnValue(qb);
    repo = new AppointmentRepository(dataSource);
  });

  it('findAgenda junta a clínica selecionando só id e nome', async () => {
    await repo.findAgenda('owner-1', ['doctor-1'], { take: 10 });

    expect(qb.leftJoin).toHaveBeenCalledWith('appointment.clinic', 'clinic');
    expect(qb.addSelect).toHaveBeenCalledWith(['clinic.id', 'clinic.name']);
  });

  it('findAgenda usa withDeleted e refaz o filtro de soft delete do root', async () => {
    await repo.findAgenda('owner-1', ['doctor-1'], { take: 10 });

    expect(qb.withDeleted).toHaveBeenCalled();
    expect(qb.andWhere).toHaveBeenCalledWith('appointment.deletedAt IS NULL');
  });

  /**
   * `.where()` limpa `expressionMap.wheres`: se o filtro de soft delete do
   * root for registrado antes dele, some sem aviso e a consulta excluída
   * volta para a agenda. Só a ORDEM protege isso — `toHaveBeenCalledWith`
   * passaria igual, esteja o `andWhere` antes ou depois do `.where()`.
   */
  function ordemDoFiltroDeSoftDelete(): { where: number; softDelete: number } {
    const indice = qb.andWhere.mock.calls.findIndex(
      ([condicao]) => condicao === 'appointment.deletedAt IS NULL',
    );
    return {
      where: qb.where.mock.invocationCallOrder[0],
      softDelete: qb.andWhere.mock.invocationCallOrder[indice],
    };
  }

  it('findAgenda registra o filtro de soft delete do root depois do .where()', async () => {
    await repo.findAgenda('owner-1', ['doctor-1'], { take: 10 });

    const { where, softDelete } = ordemDoFiltroDeSoftDelete();
    expect(softDelete).toBeGreaterThan(where);
  });

  it('findByPatient também junta a clínica com withDeleted', async () => {
    await repo.findByPatient('owner-1', ['doctor-1'], 'patient-1');

    expect(qb.leftJoin).toHaveBeenCalledWith('appointment.clinic', 'clinic');
    expect(qb.withDeleted).toHaveBeenCalled();
    expect(qb.andWhere).toHaveBeenCalledWith('appointment.deletedAt IS NULL');
  });

  it('findByPatient registra o filtro de soft delete do root depois do .where()', async () => {
    await repo.findByPatient('owner-1', ['doctor-1'], 'patient-1');

    const { where, softDelete } = ordemDoFiltroDeSoftDelete();
    expect(softDelete).toBeGreaterThan(where);
  });

  it('findOneComRelacoes busca por id trazendo paciente e clínica', async () => {
    await repo.findOneComRelacoes('appt-1');

    expect(qb.where).toHaveBeenCalledWith('appointment.id = :id', {
      id: 'appt-1',
    });
    expect(qb.leftJoin).toHaveBeenCalledWith('appointment.clinic', 'clinic');
    expect(qb.withDeleted).toHaveBeenCalled();
    expect(qb.andWhere).toHaveBeenCalledWith('appointment.deletedAt IS NULL');
  });

  it('findOneComRelacoes registra o filtro de soft delete do root depois do .where()', async () => {
    await repo.findOneComRelacoes('appt-1');

    const { where, softDelete } = ordemDoFiltroDeSoftDelete();
    expect(softDelete).toBeGreaterThan(where);
  });

  // I2: `withDeleted()` vale para a query inteira — sem uma condição própria
  // no join, o paciente soft-deletado voltaria a aparecer (nome exibido na
  // agenda, no histórico e no GET por id), quebrando o comportamento anterior
  // ao soft delete de paciente. A assimetria é proposital: só o paciente
  // ganha a condição no join; a clínica excluída deve mesmo continuar
  // aparecendo (é o próprio propósito do `withDeleted()` aqui).
  it('junta o paciente com a condição de soft delete e a clínica sem nenhuma', async () => {
    await repo.findAgenda('owner-1', ['doctor-1'], { take: 10 });

    expect(qb.leftJoin).toHaveBeenCalledWith(
      'appointment.patient',
      'patient',
      'patient.deleted_at IS NULL',
    );
    expect(qb.leftJoin).toHaveBeenCalledWith('appointment.clinic', 'clinic');
  });
  /**
   * O TypeORM fixa a condição de soft delete do join no instante em que
   * `leftJoin` é chamado, lendo `expressionMap.withDeleted` naquele momento
   * (0.3.28, `SelectQueryBuilder.join`). Com `withDeleted()` DEPOIS dos joins,
   * o SQL sai com `AND clinic.deleted_at IS NULL` e a clínica excluída volta
   * como `null` — o histórico perde o nome da unidade, que é exatamente o que
   * o soft delete existe para preservar. Só a ORDEM protege isso:
   * `toHaveBeenCalled()` passa dos dois jeitos.
   */
  function withDeletedVeioAntesDosJoins(): boolean {
    return (
      qb.withDeleted.mock.invocationCallOrder[0] <
      qb.leftJoin.mock.invocationCallOrder[0]
    );
  }

  it('findAgenda chama withDeleted antes dos joins', async () => {
    await repo.findAgenda('owner-1', ['doctor-1'], { take: 10 });

    expect(withDeletedVeioAntesDosJoins()).toBe(true);
  });

  it('findByPatient chama withDeleted antes dos joins', async () => {
    await repo.findByPatient('owner-1', ['doctor-1'], 'patient-1');

    expect(withDeletedVeioAntesDosJoins()).toBe(true);
  });

  it('findOneComRelacoes chama withDeleted antes dos joins', async () => {
    await repo.findOneComRelacoes('appointment-1');

    expect(withDeletedVeioAntesDosJoins()).toBe(true);
  });
});
