import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SKIP_CONSENT_CHECK_KEY } from 'src/shared/guards/consents.guard';
import {
  AdminSessionGuard,
  AuthenticatedAdmin,
} from '../auth/admin-session.guard';
import { IS_PUBLIC_KEY } from 'src/shared/decorators/is-public.decorator';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import {
  ExtendTrialDto,
  GrantInternalAccessDto,
  RevokeInternalAccessDto,
} from './dto/admin-subscription-actions.dto';

describe('AdminSubscriptionsController', () => {
  const service = {
    extendTrial: jest.fn(),
    grantInternalAccess: jest.fn(),
    revokeInternalAccess: jest.fn(),
  };
  const controller = new AdminSubscriptionsController(
    service as unknown as AdminSubscriptionsService,
  );
  const admin: AuthenticatedAdmin = {
    adminId: 'admin-1',
    name: 'Ana',
    email: 'ana@inexci.com',
  };

  beforeEach(() => jest.clearAllMocks());

  it('passa o ownerId da rota e o admin logado como autor', async () => {
    const extend = { days: 7, reason: 'mais prazo' };
    const grant = { reason: 'conta da equipe' };
    const revoke = { to: 'trial' as const, reason: 'fim dos testes' };

    await controller.extendTrial('o-1', admin, extend);
    await controller.grantInternalAccess('o-1', admin, grant);
    await controller.revokeInternalAccess('o-1', admin, revoke);

    expect(service.extendTrial).toHaveBeenCalledWith('o-1', 'admin-1', extend);
    expect(service.grantInternalAccess).toHaveBeenCalledWith(
      'o-1',
      'admin-1',
      grant,
    );
    expect(service.revokeInternalAccess).toHaveBeenCalledWith(
      'o-1',
      'admin-1',
      revoke,
    );
  });

  it('usa a sessão do painel, é pública para o JWT da clínica e pula consentimento', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminSubscriptionsController),
    ).toEqual([AdminSessionGuard]);
    expect(
      Reflect.getMetadata(SKIP_CONSENT_CHECK_KEY, AdminSubscriptionsController),
    ).toBe(true);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, AdminSubscriptionsController),
    ).toBe(true);
  });

  describe('validação dos DTOs', () => {
    const errorsOf = async (cls: new () => object, body: object) =>
      (await validate(plainToInstance(cls, body))).map((e) => e.property);

    it('motivo ausente, curto ou longo é recusado', async () => {
      expect(await errorsOf(GrantInternalAccessDto, {})).toContain('reason');
      expect(
        await errorsOf(GrantInternalAccessDto, { reason: '   abc  ' }),
      ).toContain('reason');
      expect(
        await errorsOf(GrantInternalAccessDto, { reason: 'x'.repeat(501) }),
      ).toContain('reason');
      expect(
        await errorsOf(GrantInternalAccessDto, { reason: 'conta da equipe' }),
      ).toEqual([]);
    });

    it('days fica entre 1 e 90 e until é ISO 8601', async () => {
      expect(
        await errorsOf(ExtendTrialDto, { days: 0, reason: 'mais prazo' }),
      ).toContain('days');
      expect(
        await errorsOf(ExtendTrialDto, { days: 91, reason: 'mais prazo' }),
      ).toContain('days');
      expect(
        await errorsOf(ExtendTrialDto, {
          until: '30/11',
          reason: 'mais prazo',
        }),
      ).toContain('until');
      expect(
        await errorsOf(ExtendTrialDto, {
          until: '2026-11-30',
          reason: 'mais prazo',
        }),
      ).toEqual([]);
    });

    it('revoke aceita só trial ou canceled e trialDays de 1 a 90', async () => {
      expect(
        await errorsOf(RevokeInternalAccessDto, {
          to: 'active',
          reason: 'fim dos testes',
        }),
      ).toContain('to');
      expect(
        await errorsOf(RevokeInternalAccessDto, {
          to: 'trial',
          trialDays: 91,
          reason: 'fim dos testes',
        }),
      ).toContain('trialDays');
      expect(
        await errorsOf(RevokeInternalAccessDto, {
          to: 'canceled',
          reason: 'fim dos testes',
        }),
      ).toEqual([]);
    });
  });
});
