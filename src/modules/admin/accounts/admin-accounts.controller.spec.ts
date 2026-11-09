import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SKIP_CONSENT_CHECK_KEY } from 'src/shared/guards/consents.guard';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { IS_PUBLIC_KEY } from 'src/shared/decorators/is-public.decorator';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAccountStatusService } from './admin-account-status.service';
import { AdminActivationService } from '../activation/admin-activation.service';

describe('AdminAccountsController', () => {
  const service = {
    list: jest.fn(),
    getDetail: jest.fn(),
    getTeam: jest.fn(),
    getSubscription: jest.fn(),
  };
  const status = { deactivate: jest.fn(), reactivate: jest.fn() };
  const activation = { getAccountActivation: jest.fn() };
  const controller = new AdminAccountsController(
    service as unknown as AdminAccountsService,
    status as unknown as AdminAccountStatusService,
    activation as unknown as AdminActivationService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('delega a listagem ao service', async () => {
    service.list.mockResolvedValue({ items: [], total: 0 });

    await controller.list({ search: 'x' });

    expect(service.list).toHaveBeenCalledWith({ search: 'x' });
  });

  it('delega detalhe, equipe e assinatura pelo ownerId', async () => {
    await controller.detail('o-1', {});
    await controller.team('o-1', {});
    await controller.subscription('o-1');

    expect(service.getDetail).toHaveBeenCalledWith('o-1', {});
    expect(service.getTeam).toHaveBeenCalledWith('o-1', 30);
    expect(service.getSubscription).toHaveBeenCalledWith('o-1');
  });

  it('repassa a janela da equipe e delega a ativação', async () => {
    await controller.team('o-1', { days: 7 });
    await controller.activation('o-1');

    expect(service.getTeam).toHaveBeenCalledWith('o-1', 7);
    expect(activation.getAccountActivation).toHaveBeenCalledWith('o-1');
  });

  it('desativa e reativa com o admin da sessão e o motivo', async () => {
    const admin = { adminId: 'adm-1' } as never;

    await controller.deactivate('o-1', admin, { reason: 'Contrato encerrado' });
    await controller.reactivate('o-1', admin, { reason: 'Voltou a pagar' });

    expect(status.deactivate).toHaveBeenCalledWith(
      'o-1',
      'adm-1',
      'Contrato encerrado',
    );
    expect(status.reactivate).toHaveBeenCalledWith(
      'o-1',
      'adm-1',
      'Voltou a pagar',
    );
  });

  it('rejeita período invertido', () => {
    expect(() =>
      controller.detail('o-1', {
        from: new Date('2026-10-02'),
        to: new Date('2026-10-01'),
      }),
    ).toThrow(BadRequestException);
    expect(service.getDetail).not.toHaveBeenCalled();
  });

  it('usa a sessão do painel, é pública para o JWT da clínica e pula consentimento', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminAccountsController),
    ).toEqual([AdminSessionGuard]);
    expect(
      Reflect.getMetadata(SKIP_CONSENT_CHECK_KEY, AdminAccountsController),
    ).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminAccountsController)).toBe(
      true,
    );
  });
});
