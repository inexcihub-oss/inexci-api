import { NotFoundException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  const userRepoMock = {
    findOne: jest.fn(),
    update: jest.fn(),
  };

  let service: OnboardingService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new OnboardingService(userRepoMock as never);
  });

  describe('get', () => {
    it('devolve o estado vazio quando a coluna é null', async () => {
      userRepoMock.findOne.mockResolvedValue({ id: 'u1', onboardingState: null });

      const estado = await service.get('u1');

      expect(estado.status).toBe('not_started');
      expect(estado.completedSteps).toEqual({});
    });

    it('devolve o estado gravado', async () => {
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

      const estado = await service.get('u1');

      expect(estado.status).toBe('in_progress');
      expect(estado.completedSteps['criar-solicitacao']).toBe(
        '2026-08-01T00:00:00.000Z',
      );
    });

    it('lança NotFound para usuário inexistente', async () => {
      userRepoMock.findOne.mockResolvedValue(null);

      await expect(service.get('u1')).rejects.toBeInstanceOf(NotFoundException);
    });
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
      expect(userRepoMock.update).toHaveBeenCalledWith('u1', {
        onboardingState: estado,
      });
    });
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
    });
  });
});
