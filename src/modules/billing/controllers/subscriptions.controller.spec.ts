import { ForbiddenException } from '@nestjs/common';

import { UserRole } from 'src/database/entities/user.entity';
import { AuthenticatedUser } from 'src/shared/decorators/current-user.decorator';
import { Permission } from 'src/shared/permissions';

import { SubscriptionsController } from './subscriptions.controller';
import { StartCheckoutDto } from '../dto/start-checkout.dto';

describe('SubscriptionsController — só o dono mexe em dinheiro', () => {
  const subscriptionService = {
    startCheckout: jest
      .fn()
      .mockResolvedValue({ url: 'https://stripe.test/checkout' }),
    openBillingPortal: jest
      .fn()
      .mockResolvedValue({ url: 'https://stripe.test/portal' }),
  };
  const quotaService = { getQuotaSnapshot: jest.fn() };

  const controller = new SubscriptionsController(
    subscriptionService as never,
    quotaService as never,
  );

  const dono: AuthenticatedUser = {
    userId: 'o-1',
    ownerId: 'o-1',
    role: UserRole.ADMIN,
    permissions: [],
  };
  const delegado: AuthenticatedUser = {
    userId: 'c-1',
    ownerId: 'o-1',
    role: UserRole.COLLABORATOR,
    permissions: [Permission.ADMINISTRACAO],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deixa o dono abrir o portal', async () => {
    await expect(controller.portal(dono, {})).resolves.not.toThrow();
  });

  it('repassa o plano escolhido para o portal', async () => {
    await controller.portal(dono, { planId: 'plan-2' });

    expect(subscriptionService.openBillingPortal).toHaveBeenCalledWith(
      dono.userId,
      'plan-2',
    );
  });

  it('bloqueia o admin delegado no portal', async () => {
    await expect(controller.portal(delegado, {})).rejects.toThrow(
      ForbiddenException,
    );
    expect(subscriptionService.openBillingPortal).not.toHaveBeenCalled();
  });

  it('deixa o dono iniciar o checkout', async () => {
    const dto: StartCheckoutDto = { planId: 'plan-1' };
    await expect(controller.checkout(dono, dto)).resolves.not.toThrow();
  });

  it('bloqueia o admin delegado no checkout', async () => {
    const dto: StartCheckoutDto = { planId: 'plan-1' };
    await expect(controller.checkout(delegado, dto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(subscriptionService.startCheckout).not.toHaveBeenCalled();
  });
});
