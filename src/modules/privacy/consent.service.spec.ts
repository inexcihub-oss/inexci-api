import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConsentService } from './consent.service';

describe('ConsentService', () => {
  const userRepoMock = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const consentLogRepoMock = {
    create: jest.fn(),
    findHistory: jest.fn(),
  };
  const eventEmitterMock = {
    emit: jest.fn(),
  };

  let service: ConsentService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ConsentService(
      userRepoMock as any,
      consentLogRepoMock as any,
      eventEmitterMock as any,
    );
  });

  describe('getStatus', () => {
    it('marca como aceito quando MAJOR coincide', async () => {
      userRepoMock.findOne.mockResolvedValue({
        id: 'u1',
        ai_consent_version: '1.0',
        ai_consent_at: new Date('2026-05-01'),
        privacy_policy_consent_version: '1.0',
        privacy_policy_consent_at: new Date('2026-05-01'),
        terms_of_use_consent_version: '1.0',
        terms_of_use_consent_at: new Date('2026-05-01'),
      });

      const status = await service.getStatus('u1');

      const ai = status.find((s) => s.type === 'ai')!;
      expect(ai.isAccepted).toBe(true);
      expect(ai.isRequired).toBe(false);
      expect(ai.acceptedVersion).toBe('1.0');

      const policy = status.find((s) => s.type === 'privacy_policy')!;
      expect(policy.isAccepted).toBe(true);
      expect(policy.isRequired).toBe(true);
    });

    it('marca como pendente quando MAJOR difere ou está nulo', async () => {
      userRepoMock.findOne.mockResolvedValue({
        id: 'u1',
        ai_consent_version: null,
        ai_consent_at: null,
        privacy_policy_consent_version: '0.9',
        privacy_policy_consent_at: new Date('2024-01-01'),
        terms_of_use_consent_version: '1.0',
        terms_of_use_consent_at: new Date('2026-05-01'),
      });

      const status = await service.getStatus('u1');

      expect(status.find((s) => s.type === 'ai')!.isAccepted).toBe(false);
      expect(status.find((s) => s.type === 'privacy_policy')!.isAccepted).toBe(
        false,
      );
      expect(status.find((s) => s.type === 'terms_of_use')!.isAccepted).toBe(
        true,
      );
    });

    it('lança NotFoundException quando usuário inexistente', async () => {
      userRepoMock.findOne.mockResolvedValue(null);
      await expect(service.getStatus('u-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getPending', () => {
    it('retorna apenas obrigatórios não aceitos', async () => {
      userRepoMock.findOne.mockResolvedValue({
        id: 'u1',
        ai_consent_version: null,
        ai_consent_at: null,
        privacy_policy_consent_version: null,
        privacy_policy_consent_at: null,
        terms_of_use_consent_version: '1.0',
        terms_of_use_consent_at: new Date('2026-05-01'),
      });

      const pending = await service.getPending('u1');

      expect(pending).toEqual(['privacy_policy']);
    });
  });

  describe('grant', () => {
    beforeEach(() => {
      userRepoMock.findOne
        .mockResolvedValueOnce({
          id: 'u1',
          ai_consent_version: null,
          ai_consent_at: null,
          privacy_policy_consent_version: null,
          privacy_policy_consent_at: null,
          terms_of_use_consent_version: null,
          terms_of_use_consent_at: null,
        })
        .mockResolvedValueOnce({
          id: 'u1',
          ai_consent_version: '1.0',
          ai_consent_at: new Date(),
          privacy_policy_consent_version: null,
          privacy_policy_consent_at: null,
          terms_of_use_consent_version: null,
          terms_of_use_consent_at: null,
        });
    });

    it('atualiza user e cria registro em consent_log', async () => {
      const status = await service.grant('u1', 'ai', '1.0', {
        ip: '1.2.3.4',
        userAgent: 'jest',
        channel: 'web',
      });

      expect(userRepoMock.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          ai_consent_version: '1.0',
          ai_consent_at: expect.any(Date),
        }),
      );
      expect(consentLogRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'u1',
          consent_type: 'ai',
          version: '1.0',
          action: 'granted',
          ip_address: '1.2.3.4',
          user_agent: 'jest',
          channel: 'web',
        }),
      );
      expect(status.isAccepted).toBe(true);
    });

    it('rejeita versão com MAJOR incompatível', async () => {
      await expect(service.grant('u1', 'ai', '2.0')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(userRepoMock.update).not.toHaveBeenCalled();
      expect(consentLogRepoMock.create).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('limpa campos do user e registra "revoked" no log', async () => {
      userRepoMock.findOne
        .mockResolvedValueOnce({
          id: 'u1',
          ai_consent_version: '1.0',
          ai_consent_at: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'u1',
          ai_consent_version: null,
          ai_consent_at: null,
        });

      const status = await service.revoke('u1', 'ai', { ip: '5.6.7.8' });

      expect(userRepoMock.update).toHaveBeenCalledWith('u1', {
        ai_consent_version: null,
        ai_consent_at: null,
      });
      expect(consentLogRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          consent_type: 'ai',
          action: 'revoked',
          ip_address: '5.6.7.8',
        }),
      );
      expect(status.isAccepted).toBe(false);
    });

    it('emite evento ai.consent.revoked ao revogar consentimento de IA', async () => {
      userRepoMock.findOne
        .mockResolvedValueOnce({
          id: 'u1',
          ai_consent_version: '1.0',
          ai_consent_at: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'u1',
          ai_consent_version: null,
          ai_consent_at: null,
        });

      await service.revoke('u1', 'ai');
      expect(eventEmitterMock.emit).toHaveBeenCalledWith('ai.consent.revoked', {
        userId: 'u1',
      });
    });

    it('não emite evento ao revogar consentimento não-IA', async () => {
      userRepoMock.findOne
        .mockResolvedValueOnce({
          id: 'u1',
          privacy_policy_consent_version: '1.0',
          privacy_policy_consent_at: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'u1',
          privacy_policy_consent_version: null,
          privacy_policy_consent_at: null,
        });

      await service.revoke('u1', 'privacy_policy');
      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
    });
  });

  describe('hasValidAiConsent', () => {
    it('valida MAJOR igual', async () => {
      await expect(
        service.hasValidAiConsent({ ai_consent_version: '1.5' } as any),
      ).resolves.toBe(true);
    });
    it('rejeita null', async () => {
      await expect(
        service.hasValidAiConsent({ ai_consent_version: null } as any),
      ).resolves.toBe(false);
    });
    it('rejeita MAJOR diferente', async () => {
      await expect(
        service.hasValidAiConsent({ ai_consent_version: '0.9' } as any),
      ).resolves.toBe(false);
    });
  });
});
