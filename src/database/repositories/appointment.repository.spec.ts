import { AppointmentRepository } from './appointment.repository';
import { AppointmentStatus } from '../entities/appointment.entity';

describe('AppointmentRepository.findAgenda', () => {
  function buildRepo() {
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
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

describe('AppointmentRepository — paginação e contagem por médico', () => {
  function buildRepo(raw: unknown[] = []) {
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getRawMany: jest.fn().mockResolvedValue(raw),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      }),
    };
    return { repo: new AppointmentRepository(dataSource as never), qb };
  }

  it('pula e limita a página, com desempate estável por id', async () => {
    const { repo, qb } = buildRepo();
    await repo.findAgenda('owner-1', ['d-1'], {
      take: 20,
      skip: 40,
      order: 'DESC',
    });
    expect(qb.orderBy).toHaveBeenCalledWith('appointment.scheduledAt', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('appointment.id', 'ASC');
    expect(qb.skip).toHaveBeenCalledWith(40);
    expect(qb.take).toHaveBeenCalledWith(20);
  });

  it('sem skip começa do início', async () => {
    const { repo, qb } = buildRepo();
    await repo.findAgenda('owner-1', ['d-1'], { take: 20 });
    expect(qb.skip).toHaveBeenCalledWith(0);
  });

  it('countByDoctor agrupa por médico no mesmo recorte, na conta', async () => {
    const { repo, qb } = buildRepo([
      { doctorId: 'd-1', total: 96 },
      { doctorId: 'd-2', total: '9' },
    ]);
    const contagem = await repo.countByDoctor('owner-1', ['d-1', 'd-2'], {
      from: new Date('2026-10-01T00:00:00.000Z'),
      statuses: [AppointmentStatus.SCHEDULED],
    });
    expect(contagem).toEqual({ 'd-1': 96, 'd-2': 9 });
    const where = qb.andWhere.mock.calls.map((c) => c[0] as string).join(' | ');
    expect(qb.where).toHaveBeenCalledWith('appointment.ownerId = :ownerId', {
      ownerId: 'owner-1',
    });
    expect(where).toContain('appointment.doctorId IN (:...doctorIds)');
    expect(where).toContain('appointment.scheduledAt >= :from');
    expect(where).toContain('appointment.status IN (:...statuses)');
    expect(qb.groupBy).toHaveBeenCalledWith('appointment.doctorId');
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

describe('AppointmentRepository — join da clínica', () => {
  const qb = {
    leftJoin: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
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
    qb.getManyAndCount.mockResolvedValue([[], 0]);
    qb.getMany.mockResolvedValue([]);
    qb.getOne.mockResolvedValue(null);
    qb.leftJoin.mockReturnValue(qb);
    qb.addSelect.mockReturnValue(qb);
    qb.where.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    qb.orderBy.mockReturnValue(qb);
    qb.addOrderBy.mockReturnValue(qb);
    qb.skip.mockReturnValue(qb);
    qb.take.mockReturnValue(qb);
    qb.withDeleted.mockReturnValue(qb);
    repo = new AppointmentRepository(dataSource);
  });

  it.each([
    [
      'findAgenda',
      () => repo.findAgenda('owner-1', ['doctor-1'], { take: 10 }),
    ],
    ['findByPatient', () => repo.findByPatient('owner-1', ['doctor-1'], 'p-1')],
    ['findOneComRelacoes', () => repo.findOneComRelacoes('a-1')],
  ])(
    '%s traz sala, convênio e autor só com id e nome',
    async (_nome, chamar) => {
      await (chamar as () => Promise<unknown>)();

      expect(qb.leftJoin).toHaveBeenCalledWith('appointment.room', 'room');
      expect(qb.leftJoin).toHaveBeenCalledWith(
        'appointment.healthPlan',
        'healthPlan',
      );
      expect(qb.leftJoin).toHaveBeenCalledWith(
        'appointment.createdBy',
        'createdBy',
      );
      expect(qb.addSelect).toHaveBeenCalledWith([
        'room.id',
        'room.name',
        'healthPlan.id',
        'healthPlan.name',
        'createdBy.id',
        'createdBy.name',
      ]);
    },
  );

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

  it('junta o paciente com a condição de soft delete e a clínica sem nenhuma', async () => {
    await repo.findAgenda('owner-1', ['doctor-1'], { take: 10 });

    expect(qb.leftJoin).toHaveBeenCalledWith(
      'appointment.patient',
      'patient',
      'patient.deleted_at IS NULL',
    );
    expect(qb.leftJoin).toHaveBeenCalledWith('appointment.clinic', 'clinic');
  });
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

describe('AppointmentRepository.findAtivaPorTelefone', () => {
  function buildRepo(resultado: unknown = null) {
    const qb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(resultado),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      }),
    };
    return { repo: new AppointmentRepository(dataSource as never), qb };
  }

  const clauses = (qb: { andWhere: jest.Mock; where: jest.Mock }) =>
    [...qb.where.mock.calls, ...qb.andWhere.mock.calls]
      .map((c) => c[0] as string)
      .join(' | ');

  const janela = {
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-08-02T06:00:00.000Z'),
  };

  it('casa o telefone do paciente ignorando máscara e formato', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAtivaPorTelefone(['11998877665', '5511998877665'], janela);

    expect(clauses(qb)).toContain(
      "regexp_replace(patient.phone, '[^0-9]', '', 'g') IN (:...phones)",
    );
  });

  it('só considera consultas ativas na agenda', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAtivaPorTelefone(['11998877665'], janela);

    const [, params] = qb.andWhere.mock.calls.find((c) =>
      (c[0] as string).includes('status'),
    )!;
    expect(
      (params as { statuses: AppointmentStatus[] }).statuses.sort(),
    ).toEqual(
      [AppointmentStatus.CONFIRMED, AppointmentStatus.SCHEDULED].sort(),
    );
  });

  it('recorta pela janela do lembrete', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAtivaPorTelefone(['11998877665'], janela);

    expect(clauses(qb)).toContain('appointment.scheduledAt >= :from');
    expect(clauses(qb)).toContain('appointment.scheduledAt < :to');
  });

  it('elege a consulta cujo lembrete saiu por último, não a mais antiga', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAtivaPorTelefone(['11998877665'], janela);

    expect(qb.orderBy).toHaveBeenCalledWith(
      'appointment.reminderSentAt',
      'DESC',
      'NULLS LAST',
    );
    expect(qb.addOrderBy).toHaveBeenCalledWith(
      'appointment.scheduledAt',
      'ASC',
    );
  });

  it('não consulta o banco quando não há telefone para casar', async () => {
    const { repo, qb } = buildRepo();

    await expect(repo.findAtivaPorTelefone([], janela)).resolves.toBeNull();
    expect(qb.getOne).not.toHaveBeenCalled();
  });

  it('traz o endereço da unidade para montar a resposta ao paciente', async () => {
    const { repo, qb } = buildRepo();

    await repo.findAtivaPorTelefone(['11998877665'], janela);

    const colunas = qb.addSelect.mock.calls.flatMap((c) => c[0] as string[]);
    expect(colunas).toEqual(
      expect.arrayContaining([
        'clinic.name',
        'clinic.address',
        'clinic.addressNumber',
        'clinic.neighborhood',
        'clinic.city',
        'clinic.state',
      ]),
    );
  });
});

describe('AppointmentRepository.hasOverlap', () => {
  const qb = {
    where: jest.fn(),
    andWhere: jest.fn(),
    getCount: jest.fn(),
  };
  const repository = { createQueryBuilder: jest.fn(() => qb), metadata: {} };
  const repo = new AppointmentRepository({
    getRepository: () => repository,
  } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    qb.where.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    qb.getCount.mockResolvedValue(0);
  });

  it('realizada ocupa o horário; cancelada e falta não', async () => {
    await repo.hasOverlap('d-1', new Date(), new Date());

    const [, { ocupam }] = qb.andWhere.mock.calls.find(
      ([sql]: [string]) => sql === 'appointment.status IN (:...ocupam)',
    );
    expect(ocupam).toContain('completed');
    expect(ocupam).not.toContain('cancelled');
    expect(ocupam).not.toContain('no_show');
  });

  it('ignora a própria consulta ao reagendar', async () => {
    await repo.hasOverlap('d-1', new Date(), new Date(), 'a-1');

    expect(qb.andWhere).toHaveBeenCalledWith('appointment.id != :excludeId', {
      excludeId: 'a-1',
    });
  });

  it('por padrão conta encaixes (bloqueia consulta normal nova sobre encaixe)', async () => {
    await repo.hasOverlap('d-1', new Date(), new Date());

    expect(qb.andWhere).not.toHaveBeenCalledWith(
      'appointment.isWalkIn = false',
    );
  });

  it('ignorarEncaixes segue a exclusion constraint e deixa encaixes de fora', async () => {
    await repo.hasOverlap('d-1', new Date(), new Date(), 'a-1', {
      ignorarEncaixes: true,
    });

    expect(qb.andWhere).toHaveBeenCalledWith('appointment.isWalkIn = false');
  });

  it('há conflito quando alguma consulta ocupa o intervalo', async () => {
    qb.getCount.mockResolvedValue(1);

    await expect(repo.hasOverlap('d-1', new Date(), new Date())).resolves.toBe(
      true,
    );
  });
});
