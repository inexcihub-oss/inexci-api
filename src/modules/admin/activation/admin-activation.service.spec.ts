import { NotFoundException } from '@nestjs/common';
import { UserStatus } from 'src/database/entities/user.entity';
import { AdminActivationRepository } from 'src/database/repositories/admin-activation.repository';
import { AdminActivationService } from './admin-activation.service';

describe('AdminActivationService', () => {
  const repository = {
    findMilestones: jest.fn(),
    findMembersOnboarding: jest.fn(),
    findCohortMilestones: jest.fn(),
  };
  const service = new AdminActivationService(
    repository as unknown as AdminActivationRepository,
  );
  const signupAt = new Date('2026-10-01T12:00:00Z');

  beforeEach(() => jest.resetAllMocks());

  it('monta marcos e onboarding da conta', async () => {
    repository.findMilestones.mockResolvedValue({
      ownerId: 'o-1',
      signupAt,
      firstPatientAt: null,
      firstAppointmentAt: new Date('2026-10-03T12:00:00Z'),
      firstSurgeryRequestAt: null,
      firstSentAt: null,
      firstWhatsappAt: null,
    });
    repository.findMembersOnboarding.mockResolvedValue([
      { userId: 'o-1', status: UserStatus.ACTIVE, onboardingState: null },
    ]);

    const result = await service.getAccountActivation('o-1');

    expect(repository.findMilestones).toHaveBeenCalledWith('o-1');
    expect(result.daysToActivate).toBe(2);
    expect(result.onboarding.members).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/patientName|cpf/i);
  });

  it('conta inexistente vira 404', async () => {
    repository.findMilestones.mockResolvedValue(null);
    repository.findMembersOnboarding.mockResolvedValue([]);
    await expect(service.getAccountActivation('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('coorte usa o intervalo recebido', async () => {
    repository.findCohortMilestones.mockResolvedValue([]);
    const range = { from: signupAt, to: new Date('2026-10-31T12:00:00Z') };
    const result = await service.cohort(range);
    expect(repository.findCohortMilestones).toHaveBeenCalledWith(range);
    expect(result.cohortAccounts).toBe(0);
  });
});
