import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  FinancialAccount,
  FinancialAccountType,
} from 'src/database/entities/financial-account.entity';
import {
  PAYMENT_METHODS,
  PaymentMethod,
  PaymentMethodConfig,
} from 'src/database/entities/payment-method-config.entity';
import {
  NovaConfiguracaoDeForma,
  PaymentMethodConfigRepository,
} from 'src/database/repositories/payment-method-config.repository';
import { FinancialAccountsService } from './financial-accounts.service';
import {
  PARCELAS_FORA_DO_LIMITE,
  PARCELAS_SO_NO_CREDITO,
  PaymentMethodConfigsService,
} from './payment-method-configs.service';

const OWNER = 'owner-1';
const USER = 'user-1';

function contaAtiva(dados: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: 'conta-1',
    ownerId: OWNER,
    name: 'Stone Crédito',
    type: FinancialAccountType.CARD_CREDIT,
    active: true,
    ...dados,
  } as FinancialAccount;
}

describe('PaymentMethodConfigsService', () => {
  let banco: PaymentMethodConfig[];
  let repository: {
    findByOwnerWithAccount: jest.Mock;
    insertMissing: jest.Mock;
    save: jest.Mock;
  };
  let accountsService: { findActiveOwnedOrFail: jest.Mock };
  let service: PaymentMethodConfigsService;

  beforeEach(() => {
    banco = [];
    repository = {
      findByOwnerWithAccount: jest.fn((ownerId: string) =>
        Promise.resolve(
          banco.filter((c) => c.ownerId === ownerId).map((c) => ({ ...c })),
        ),
      ),
      insertMissing: jest.fn(
        (
          ownerId: string,
          createdById: string,
          novas: NovaConfiguracaoDeForma[],
        ) => {
          novas.forEach((nova) =>
            banco.push({
              id: `cfg-${nova.method}`,
              ownerId,
              createdById,
              defaultAccount: null,
              ...nova,
            } as PaymentMethodConfig),
          );
          return Promise.resolve();
        },
      ),
      save: jest.fn((c: PaymentMethodConfig) => Promise.resolve({ ...c })),
    };
    accountsService = { findActiveOwnedOrFail: jest.fn() };
    service = new PaymentMethodConfigsService(
      repository as unknown as PaymentMethodConfigRepository,
      accountsService as unknown as FinancialAccountsService,
    );
  });

  describe('list', () => {
    it('cria as 8 formas no primeiro acesso, com os padrões do contrato', async () => {
      const resultado = await service.list(OWNER, USER);

      expect(repository.insertMissing).toHaveBeenCalledTimes(1);
      expect(resultado.map((c) => c.method)).toEqual(PAYMENT_METHODS);
      expect(resultado.filter((c) => c.active).map((c) => c.method)).toEqual([
        PaymentMethod.CASH,
        PaymentMethod.PIX,
        PaymentMethod.CREDIT_CARD,
        PaymentMethod.DEBIT_CARD,
      ]);
      resultado.forEach((c) => {
        expect(c.defaultAccountId).toBeNull();
        expect(c.defaultAccount).toBeNull();
        expect(c.maxInstallments).toBe(1);
      });
    });

    it('não recria o que já existe no segundo acesso', async () => {
      await service.list(OWNER, USER);
      await service.list(OWNER, USER);
      expect(repository.insertMissing).toHaveBeenCalledTimes(1);
    });

    it('completa só as formas que faltam', async () => {
      banco.push({
        id: 'cfg-pix',
        ownerId: OWNER,
        method: PaymentMethod.PIX,
        active: false,
        maxInstallments: 1,
        defaultAccountId: null,
        defaultAccount: null,
      } as PaymentMethodConfig);

      const resultado = await service.list(OWNER, USER);

      const inseridas = (
        repository.insertMissing.mock.calls[0][2] as NovaConfiguracaoDeForma[]
      ).map((c) => c.method);
      expect(inseridas).not.toContain(PaymentMethod.PIX);
      expect(inseridas).toHaveLength(7);
      expect(
        resultado.find((c) => c.method === PaymentMethod.PIX)?.active,
      ).toBe(false);
    });

    it('isola por tenant: a configuração de uma conta não aparece em outra', async () => {
      await service.list('owner-2', USER);
      const resultado = await service.list(OWNER, USER);
      expect(resultado).toHaveLength(8);
      expect(repository.findByOwnerWithAccount).toHaveBeenCalledWith(OWNER);
      expect(banco.filter((c) => c.ownerId === OWNER)).toHaveLength(8);
    });

    it('devolve a conta de destino resumida', async () => {
      banco.push({
        id: 'cfg-cash',
        ownerId: OWNER,
        method: PaymentMethod.CASH,
        active: true,
        maxInstallments: 1,
        defaultAccountId: 'conta-1',
        defaultAccount: contaAtiva({ name: 'Caixa Físico' }),
      } as PaymentMethodConfig);

      const resultado = await service.list(OWNER, USER);

      expect(resultado[0]).toEqual({
        method: PaymentMethod.CASH,
        active: true,
        defaultAccountId: 'conta-1',
        defaultAccount: { id: 'conta-1', name: 'Caixa Físico' },
        maxInstallments: 1,
      });
    });
  });

  describe('update', () => {
    it('liga a forma à conta ativa do tenant', async () => {
      accountsService.findActiveOwnedOrFail.mockResolvedValue(contaAtiva());

      const resultado = await service.update(
        OWNER,
        USER,
        PaymentMethod.CREDIT_CARD,
        { active: true, defaultAccountId: 'conta-1', maxInstallments: 12 },
      );

      expect(accountsService.findActiveOwnedOrFail).toHaveBeenCalledWith(
        OWNER,
        'conta-1',
      );
      expect(resultado).toEqual({
        method: PaymentMethod.CREDIT_CARD,
        active: true,
        defaultAccountId: 'conta-1',
        defaultAccount: { id: 'conta-1', name: 'Stone Crédito' },
        maxInstallments: 12,
      });
    });

    it('grava quem alterou a configuração', async () => {
      await service.update(OWNER, 'quem-editou', PaymentMethod.PIX, {
        active: true,
        defaultAccountId: null,
        maxInstallments: 1,
      });
      expect(repository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ updatedById: 'quem-editou' }),
      );
    });

    it('aceita remover a conta de destino', async () => {
      const resultado = await service.update(OWNER, USER, PaymentMethod.PIX, {
        active: false,
        defaultAccountId: null,
        maxInstallments: 1,
      });

      expect(accountsService.findActiveOwnedOrFail).not.toHaveBeenCalled();
      expect(resultado.defaultAccountId).toBeNull();
      expect(resultado.active).toBe(false);
    });

    it('recusa conta inativa como destino (400)', async () => {
      accountsService.findActiveOwnedOrFail.mockRejectedValue(
        new BadRequestException('A conta financeira está inativa'),
      );

      await expect(
        service.update(OWNER, USER, PaymentMethod.PIX, {
          active: true,
          defaultAccountId: 'conta-1',
          maxInstallments: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('dá 404 para conta de destino de outro tenant', async () => {
      accountsService.findActiveOwnedOrFail.mockRejectedValue(
        new NotFoundException('Conta financeira não encontrada'),
      );

      await expect(
        service.update(OWNER, USER, PaymentMethod.PIX, {
          active: true,
          defaultAccountId: 'conta-de-outro',
          maxInstallments: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it.each(
      PAYMENT_METHODS.filter((m) => m !== PaymentMethod.CREDIT_CARD).map(
        (m) => [m],
      ),
    )('recusa parcelamento em %s', async (method) => {
      await expect(
        service.update(OWNER, USER, method, {
          active: true,
          defaultAccountId: null,
          maxInstallments: 2,
        }),
      ).rejects.toThrow(new BadRequestException(PARCELAS_SO_NO_CREDITO));
    });

    it.each([0, 25, 1.5])(
      'recusa %p parcelas no crédito',
      async (maxInstallments) => {
        await expect(
          service.update(OWNER, USER, PaymentMethod.CREDIT_CARD, {
            active: true,
            defaultAccountId: null,
            maxInstallments,
          }),
        ).rejects.toThrow(new BadRequestException(PARCELAS_FORA_DO_LIMITE));
      },
    );

    it('aceita 24 parcelas no crédito', async () => {
      const resultado = await service.update(
        OWNER,
        USER,
        PaymentMethod.CREDIT_CARD,
        { active: true, defaultAccountId: null, maxInstallments: 24 },
      );
      expect(resultado.maxInstallments).toBe(24);
    });

    it('cria as padrões antes de editar no primeiro acesso', async () => {
      await service.update(OWNER, USER, PaymentMethod.BOLETO, {
        active: true,
        defaultAccountId: null,
        maxInstallments: 1,
      });

      expect(repository.insertMissing).toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: OWNER,
          method: PaymentMethod.BOLETO,
          active: true,
        }),
      );
    });
  });
});
