import { Repository } from 'typeorm';
import { User, UserStatus } from '../entities/user.entity';
import { AdminActivationRepository } from './admin-activation.repository';

describe('AdminActivationRepository', () => {
  const query = jest.fn();
  const find = jest.fn();
  const repo = {
    manager: { query },
    find,
  } as unknown as Repository<User>;
  const repository = new AdminActivationRepository(repo);
  const range = {
    from: new Date('2026-10-01T03:00:00Z'),
    to: new Date('2026-10-31T03:00:00Z'),
  };

  beforeEach(() => jest.resetAllMocks());

  it('marcos de uma conta: uma única consulta com MIN por marco, só para o dono', async () => {
    query.mockResolvedValue([
      {
        ownerId: 'o-1',
        signupAt: '2026-10-01T12:00:00.000Z',
        firstPatientAt: '2026-10-02T12:00:00.000Z',
        firstAppointmentAt: null,
        firstSurgeryRequestAt: null,
        firstSentAt: null,
        firstWhatsappAt: null,
      },
    ]);

    const row = await repository.findMilestones('o-1');

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('MIN(p.created_at) FROM patients p');
    expect(sql).toContain('MIN(sr.sent_at)');
    expect(sql).toContain('ai_token_usage_logs');
    expect(sql).toContain("m.role = 'user'");
    expect(sql).toContain('o.owner_id = o.id');
    expect(params).toEqual(['o-1']);
    expect(row?.firstPatientAt).toEqual(new Date('2026-10-02T12:00:00Z'));
    expect(row?.firstAppointmentAt).toBeNull();
  });

  it('marcos de conta inexistente devolvem null', async () => {
    query.mockResolvedValue([]);
    expect(await repository.findMilestones('x')).toBeNull();
  });

  it('coorte: só contas cliente cadastradas no intervalo', async () => {
    query.mockResolvedValue([]);
    await repository.findCohortMilestones(range);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("cs.status <> 'internal'");
    expect(sql).toContain('o.created_at >= $1 AND o.created_at < $2');
    expect(sql).toContain('o.deleted_at IS NULL');
    expect(params).toEqual([range.from, range.to]);
  });

  it('uso por usuário: contagens no período, convertidas para número', async () => {
    query.mockResolvedValue([
      {
        userId: 'u-1',
        surgeryRequests: '3',
        appointments: '0',
        recordsFinalized: null,
        assistantMessages: '7',
        aiCostUsdCents: '125',
      },
    ]);

    const rows = await repository.findMemberUsage('o-1', range);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('sr.created_by_id = u.id');
    expect(sql).toContain('a.created_by_id = u.id');
    expect(sql).toContain('cr.doctor_id = u.id');
    expect(sql).toContain('c.user_id = u.id');
    expect(sql).toContain('l.user_id = u.id');
    expect(sql).toContain('u.deleted_at IS NULL');
    expect(params).toEqual(['o-1', range.from, range.to]);
    expect(rows).toEqual([
      {
        userId: 'u-1',
        surgeryRequests: 3,
        appointments: 0,
        recordsFinalized: 0,
        assistantMessages: 7,
        aiCostUsdCents: 125,
      },
    ]);
  });

  it('onboarding dos integrantes lê só id, situação e estado', async () => {
    find.mockResolvedValue([
      { id: 'u-1', status: UserStatus.ACTIVE, onboardingState: null },
    ]);
    const rows = await repository.findMembersOnboarding('o-1');
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, status: true, onboardingState: true },
        where: { ownerId: 'o-1' },
      }),
    );
    expect(rows).toEqual([
      { userId: 'u-1', status: UserStatus.ACTIVE, onboardingState: null },
    ]);
  });
});
