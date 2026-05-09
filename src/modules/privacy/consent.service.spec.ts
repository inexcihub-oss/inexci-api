import { NotFoundException } from '@nestjs/common';
import { ConsentService } from './consent.service';

describe('ConsentService', () => {
  const userRepoMock = {
    findOne: jest.fn(),
    update: jest.fn(),
  };

  let service: ConsentService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ConsentService(userRepoMock as any);
  });

  describe('getStatus', () => {
    it('marca como aceito quando os campos *_accepted_at estão preenchidos', async () => {
      userRepoMock.findOne.mockResolvedValue({
        id: 'u1',
        privacyPolicyAcceptedAt: new Date('2026-05-01'),
        termsOfUseAcceptedAt: new Date('2026-05-01'),
        aiConsentAcceptedAt: new Date('2026-05-01'),
      });

      const status = await service.getStatus('u1');

      expect(status.requiredConsentsAccepted).toBe(true);
      expect(status.pendingRequired).toEqual([]);
      expect(status.aiConsentAcceptedAt).toBeInstanceOf(Date);
    });

    it('lista os obrigatórios pendentes quando timestamps estão nulos', async () => {
      userRepoMock.findOne.mockResolvedValue({
        id: 'u1',
        privacyPolicyAcceptedAt: null,
        termsOfUseAcceptedAt: new Date('2026-05-01'),
        aiConsentAcceptedAt: null,
      });

      const status = await service.getStatus('u1');

      expect(status.requiredConsentsAccepted).toBe(false);
      expect(status.pendingRequired).toEqual(['privacy_policy']);
      expect(status.aiConsentAcceptedAt).toBeNull();
    });

    it('lança NotFoundException quando usuário não existe', async () => {
      userRepoMock.findOne.mockResolvedValue(null);
      await expect(service.getStatus('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('acceptTerms', () => {
    it('grava timestamps em privacy_policy_accepted_at e terms_of_use_accepted_at', async () => {
      userRepoMock.findOne.mockResolvedValue({
        id: 'u1',
        privacyPolicyAcceptedAt: null,
        termsOfUseAcceptedAt: null,
        aiConsentAcceptedAt: null,
      });

      const result = await service.acceptTerms('u1');

      expect(userRepoMock.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          privacyPolicyAcceptedAt: expect.any(Date),
          termsOfUseAcceptedAt: expect.any(Date),
        }),
      );
      expect(result.requiredConsentsAccepted).toBe(true);
    });
  });

  describe('grantAi / revokeAi', () => {
    it('grantAi grava ai_consent_accepted_at', async () => {
      userRepoMock.findOne.mockResolvedValue({
        id: 'u1',
        privacyPolicyAcceptedAt: new Date(),
        termsOfUseAcceptedAt: new Date(),
        aiConsentAcceptedAt: null,
      });

      const result = await service.grantAi('u1');

      expect(userRepoMock.update).toHaveBeenCalledWith('u1', {
        aiConsentAcceptedAt: expect.any(Date),
      });
      expect(result.aiConsentAcceptedAt).toBeInstanceOf(Date);
    });

    it('revokeAi zera ai_consent_accepted_at', async () => {
      userRepoMock.findOne.mockResolvedValue({
        id: 'u1',
        privacyPolicyAcceptedAt: new Date(),
        termsOfUseAcceptedAt: new Date(),
        aiConsentAcceptedAt: new Date(),
      });

      const result = await service.revokeAi('u1');

      expect(userRepoMock.update).toHaveBeenCalledWith('u1', {
        aiConsentAcceptedAt: null,
      });
      expect(result.aiConsentAcceptedAt).toBeNull();
    });
  });

  describe('hasValidAiConsent', () => {
    it('retorna true quando o timestamp existe', () => {
      expect(
        service.hasValidAiConsent({ aiConsentAcceptedAt: new Date() } as any),
      ).toBe(true);
    });

    it('retorna false quando o timestamp é null', () => {
      expect(
        service.hasValidAiConsent({ aiConsentAcceptedAt: null } as any),
      ).toBe(false);
    });
  });
});
