import { NotFoundException } from '@nestjs/common';
import { User } from '../../database/entities/user.entity';
import { OnboardingService } from './onboarding.service';
import { UserRepository } from '../../database/repositories/user.repository';

describe('OnboardingService', () => {
  const userRepoMock = {
    findOne: jest.fn(),
    update: jest.fn(),
    manager: {
      transaction: jest.fn(),
    },
  };

  let service: OnboardingService;

  beforeEach(() => {
    jest.resetAllMocks();
    userRepoMock.manager.transaction.mockImplementation(async (work) =>
      work({
        findOne: userRepoMock.findOne,
        update: userRepoMock.update,
      }),
    );
    service = new OnboardingService(
      new UserRepository({ manager: userRepoMock.manager } as never),
    );
  });

  describe('patch', () => {
    it('funde o patch e grava o resultado', async () => {
      userRepoMock.findOne.mockResolvedValue({
        id: 'u1',
        onboardingState: {
          version: 1,
          status: 'in_progress',
          welcomeSeenAt: '2026-08-01T00:00:00.000Z',
          checklistDismissedAt: null,
          completedSteps: { 'criar-solicitacao': '2026-08-01T00:00:00.000Z' },
          toursSeen: {},
          restartedAt: null,
        },
      });

      const estado = await service.patch('u1', {
        completedSteps: { 'enviar-solicitacao': '2026-08-02T00:00:00.000Z' },
      });

      expect(estado.completedSteps).toEqual({
        'criar-solicitacao': '2026-08-01T00:00:00.000Z',
        'enviar-solicitacao': '2026-08-02T00:00:00.000Z',
      });
      expect(estado.welcomeSeenAt).toBe('2026-08-01T00:00:00.000Z');
      expect(userRepoMock.update).toHaveBeenCalledWith(User, 'u1', {
        onboardingState: estado,
      });
      expect(userRepoMock.findOne).toHaveBeenCalledWith(
        User,
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });
  });

  it('lança NotFound para usuário inexistente', async () => {
    userRepoMock.findOne.mockResolvedValue(null);

    await expect(service.patch('u1', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(userRepoMock.update).not.toHaveBeenCalled();
  });

  describe('reset', () => {
    it('zera o estado e carimba restartedAt', async () => {
      userRepoMock.findOne.mockResolvedValue({
        id: 'u1',
        onboardingState: {
          version: 1,
          status: 'completed',
          welcomeSeenAt: '2026-08-01T00:00:00.000Z',
          checklistDismissedAt: '2026-08-01T00:00:00.000Z',
          completedSteps: { 'criar-solicitacao': '2026-08-01T00:00:00.000Z' },
          toursSeen: { solicitacoes: '2026-08-01T00:00:00.000Z' },
          restartedAt: null,
        },
      });

      const estado = await service.reset('u1');

      expect(estado.status).toBe('not_started');
      expect(estado.completedSteps).toEqual({});
      expect(estado.toursSeen).toEqual({});
      expect(estado.welcomeSeenAt).toBeNull();
      expect(estado.checklistDismissedAt).toBeNull();
      expect(estado.restartedAt).not.toBeNull();
      expect(userRepoMock.update).toHaveBeenCalledWith(User, 'u1', {
        onboardingState: estado,
      });
    });
  });
});
