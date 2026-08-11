import { UserRole } from 'src/database/entities/user.entity';
import { AuthenticatedUser } from 'src/shared/decorators/current-user.decorator';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';

import { QuotaController } from './quota.controller';

describe('QuotaController — cota é de quem cria solicitação, não só do dono', () => {
  const quotaService = { getQuotaStatus: jest.fn() };
  const controller = new QuotaController(quotaService as never);

  const dono: AuthenticatedUser = {
    userId: 'o-1',
    ownerId: 'o-1',
    role: UserRole.ADMIN,
    permissions: [Permission.SOLICITACOES],
  };
  const medico: AuthenticatedUser = {
    userId: 'm-1',
    ownerId: 'o-1',
    role: UserRole.COLLABORATOR,
    permissions: [Permission.SOLICITACOES],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    quotaService.getQuotaStatus.mockResolvedValue(null);
  });

  it('exige Permission.SOLICITACOES na rota', () => {
    const required = Reflect.getMetadata(PERMISSIONS_KEY, controller.me);
    expect(required).toEqual([Permission.SOLICITACOES]);
  });

  it('escopa a leitura pelo ownerId do JWT, não pelo userId', async () => {
    await controller.me(medico);
    expect(quotaService.getQuotaStatus).toHaveBeenCalledWith('o-1');
  });

  it('usa o próprio id quando o usuário é o dono (ownerId = self)', async () => {
    await controller.me(dono);
    expect(quotaService.getQuotaStatus).toHaveBeenCalledWith('o-1');
  });

  it('cai para o userId quando o token não traz ownerId', async () => {
    await controller.me({ ...medico, ownerId: null });
    expect(quotaService.getQuotaStatus).toHaveBeenCalledWith('m-1');
  });

  it('devolve o status da cota sem campos de cobrança', async () => {
    quotaService.getQuotaStatus.mockResolvedValue({
      used: 17,
      limit: 20,
      isUnlimited: false,
      remaining: 3,
      periodStart: new Date('2026-08-01'),
      periodEnd: new Date('2026-09-01'),
    });

    const resultado = await controller.me(medico);

    expect(Object.keys(resultado!).sort()).toEqual([
      'isUnlimited',
      'limit',
      'periodEnd',
      'periodStart',
      'remaining',
      'used',
    ]);
  });

  it('devolve null quando a conta não tem período de cota ativo', async () => {
    await expect(controller.me(medico)).resolves.toBeNull();
  });
});
