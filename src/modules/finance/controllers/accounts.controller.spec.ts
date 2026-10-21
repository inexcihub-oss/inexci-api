import { FinancialAccountType } from 'src/database/entities/financial-account.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { UserRole } from 'src/database/entities/user.entity';
import { Permission } from 'src/shared/permissions';
import { AuthenticatedUser } from 'src/shared/decorators/current-user.decorator';
import { FinancialAccountsService } from '../services/financial-accounts.service';
import { PaymentMethodConfigsService } from '../services/payment-method-configs.service';
import { AccountsController } from './accounts.controller';
import { PaymentMethodsController } from './payment-methods.controller';

const colaborador: AuthenticatedUser = {
  userId: 'colab-1',
  ownerId: 'owner-1',
  role: UserRole.COLLABORATOR,
  permissions: [Permission.FINANCEIRO],
};

describe('controllers do financeiro — repasse do tenant', () => {
  it('AccountsController usa o ownerId do usuário, não o id dele', async () => {
    const service = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      setStatus: jest.fn().mockResolvedValue({}),
    };
    const controller = new AccountsController(
      service as unknown as FinancialAccountsService,
    );

    await controller.findAll({ includeInactive: true }, colaborador);
    await controller.findAll({}, colaborador);
    await controller.create(
      { name: 'Caixa', type: FinancialAccountType.CASH_DRAWER },
      colaborador,
    );
    await controller.update('c-1', { name: 'Gaveta' }, colaborador);
    await controller.updateStatus('c-1', { active: false }, colaborador);

    expect(service.list).toHaveBeenNthCalledWith(1, 'owner-1', true);
    expect(service.list).toHaveBeenNthCalledWith(2, 'owner-1', false);
    expect(service.create).toHaveBeenCalledWith('owner-1', 'colab-1', {
      name: 'Caixa',
      type: FinancialAccountType.CASH_DRAWER,
    });
    expect(service.update).toHaveBeenCalledWith('owner-1', 'colab-1', 'c-1', {
      name: 'Gaveta',
    });
    expect(service.setStatus).toHaveBeenCalledWith(
      'owner-1',
      'colab-1',
      'c-1',
      false,
    );
  });

  it('usa o próprio id como tenant quando o ownerId é nulo (dono legado)', async () => {
    const service = { list: jest.fn().mockResolvedValue([]) };
    const controller = new AccountsController(
      service as unknown as FinancialAccountsService,
    );
    await controller.findAll({}, { ...colaborador, ownerId: null });
    expect(service.list).toHaveBeenCalledWith('colab-1', false);
  });

  it('PaymentMethodsController repassa tenant, autor e forma', async () => {
    const service = {
      list: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    };
    const controller = new PaymentMethodsController(
      service as unknown as PaymentMethodConfigsService,
    );
    const dto = { active: true, defaultAccountId: null, maxInstallments: 1 };

    await controller.findAll(colaborador);
    await controller.update(PaymentMethod.PIX, dto, colaborador);

    expect(service.list).toHaveBeenCalledWith('owner-1', 'colab-1');
    expect(service.update).toHaveBeenCalledWith(
      'owner-1',
      'colab-1',
      PaymentMethod.PIX,
      dto,
    );
  });
});
