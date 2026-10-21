import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  FinancialAccount,
  FinancialAccountType,
} from 'src/database/entities/financial-account.entity';
import { CashSessionRepository } from 'src/database/repositories/cash-session.repository';
import { FinancialAccountRepository } from 'src/database/repositories/financial-account.repository';
import {
  CONTA_INATIVA,
  CONTA_NAO_ENCONTRADA,
  FinancialAccountsService,
  TIPO_COM_CAIXA_ABERTO,
} from './financial-accounts.service';

const OWNER = 'owner-1';
const OUTRO_OWNER = 'owner-2';

function conta(dados: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: 'conta-1',
    ownerId: OWNER,
    name: 'Caixa Físico',
    type: FinancialAccountType.CASH_DRAWER,
    active: true,
    notes: null,
    createdById: 'u-1',
    createdAt: new Date('2026-10-20T10:00:00Z'),
    updatedAt: new Date('2026-10-20T10:00:00Z'),
    ...dados,
  } as FinancialAccount;
}

describe('FinancialAccountsService', () => {
  let repository: jest.Mocked<
    Pick<
      FinancialAccountRepository,
      'findByOwner' | 'findOwned' | 'create' | 'save'
    >
  >;
  let service: FinancialAccountsService;
  let caixas: { hasOpenForAccount: jest.Mock };

  beforeEach(() => {
    repository = {
      findByOwner: jest.fn(),
      findOwned: jest.fn(),
      create: jest.fn(),
      save: jest.fn((c: FinancialAccount) => Promise.resolve(c)),
    };
    caixas = { hasOpenForAccount: jest.fn().mockResolvedValue(false) };
    service = new FinancialAccountsService(
      repository as unknown as FinancialAccountRepository,
      caixas as unknown as CashSessionRepository,
    );
  });

  it('lista só as ativas por padrão e devolve o DTO sem campos internos', async () => {
    repository.findByOwner.mockResolvedValue([conta()]);

    const resultado = await service.list(OWNER);

    expect(repository.findByOwner).toHaveBeenCalledWith(OWNER, {
      includeInactive: false,
    });
    expect(resultado).toEqual([
      {
        id: 'conta-1',
        name: 'Caixa Físico',
        type: FinancialAccountType.CASH_DRAWER,
        active: true,
        notes: null,
        createdAt: new Date('2026-10-20T10:00:00Z'),
      },
    ]);
    expect(resultado[0]).not.toHaveProperty('ownerId');
  });

  it('repassa includeInactive ao repositório', async () => {
    repository.findByOwner.mockResolvedValue([]);
    await service.list(OWNER, true);
    expect(repository.findByOwner).toHaveBeenCalledWith(OWNER, {
      includeInactive: true,
    });
  });

  it('cria a conta no tenant de quem pediu, ativa e com o autor', async () => {
    repository.create.mockImplementation((dados) =>
      Promise.resolve(conta(dados as Partial<FinancialAccount>)),
    );

    await service.create(OWNER, 'u-9', {
      name: 'Stone Crédito',
      type: FinancialAccountType.CARD_CREDIT,
      notes: '',
    });

    expect(repository.create).toHaveBeenCalledWith({
      ownerId: OWNER,
      createdById: 'u-9',
      name: 'Stone Crédito',
      type: FinancialAccountType.CARD_CREDIT,
      notes: null,
      active: true,
    });
  });

  it('atualiza só os campos enviados', async () => {
    repository.findOwned.mockResolvedValue(conta({ notes: 'antiga' }));

    const resultado = await service.update(OWNER, 'u-2', 'conta-1', {
      name: 'Gaveta',
    });

    expect(repository.findOwned).toHaveBeenCalledWith('conta-1', OWNER);
    expect(resultado.name).toBe('Gaveta');
    expect(resultado.type).toBe(FinancialAccountType.CASH_DRAWER);
    expect(resultado.notes).toBe('antiga');
  });

  it('grava quem alterou a conta', async () => {
    repository.findOwned.mockResolvedValue(conta());
    await service.update(OWNER, 'u-2', 'conta-1', { name: 'Gaveta' });
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ updatedById: 'u-2' }),
    );
    await service.setStatus(OWNER, 'u-3', 'conta-1', false);
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ updatedById: 'u-3' }),
    );
  });

  it('bloqueia trocar o tipo da conta com caixa aberto nela', async () => {
    repository.findOwned.mockResolvedValue(conta());
    caixas.hasOpenForAccount.mockResolvedValue(true);
    await expect(
      service.update(OWNER, 'u-2', 'conta-1', {
        type: FinancialAccountType.BANK,
      }),
    ).rejects.toThrow(TIPO_COM_CAIXA_ABERTO);
    expect(caixas.hasOpenForAccount).toHaveBeenCalledWith('conta-1', OWNER);
    expect(repository.save).not.toHaveBeenCalled();
    const renomeada = await service.update(OWNER, 'u-2', 'conta-1', {
      name: 'Gaveta',
      type: FinancialAccountType.CASH_DRAWER,
    });
    expect(renomeada.name).toBe('Gaveta');
  });

  it('limpa as observações quando vêm nulas', async () => {
    repository.findOwned.mockResolvedValue(conta({ notes: 'antiga' }));
    const resultado = await service.update(OWNER, 'u-2', 'conta-1', {
      notes: null,
    });
    expect(resultado.notes).toBeNull();
  });

  it('dá 404 ao editar conta de outro tenant', async () => {
    repository.findOwned.mockResolvedValue(null);

    await expect(
      service.update(OUTRO_OWNER, 'u-2', 'conta-1', { name: 'X' }),
    ).rejects.toThrow(new NotFoundException(CONTA_NAO_ENCONTRADA));
    expect(repository.findOwned).toHaveBeenCalledWith('conta-1', OUTRO_OWNER);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('desativa e reativa a conta', async () => {
    repository.findOwned.mockResolvedValue(conta());
    expect(
      (await service.setStatus(OWNER, 'u-2', 'conta-1', false)).active,
    ).toBe(false);
    repository.findOwned.mockResolvedValue(conta({ active: false }));
    expect(
      (await service.setStatus(OWNER, 'u-2', 'conta-1', true)).active,
    ).toBe(true);
  });

  it('dá 404 ao mudar status de conta de outro tenant', async () => {
    repository.findOwned.mockResolvedValue(null);
    await expect(
      service.setStatus(OUTRO_OWNER, 'u-2', 'conta-1', false),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('findActiveOwnedOrFail', () => {
    it('devolve a conta ativa do tenant', async () => {
      repository.findOwned.mockResolvedValue(conta());
      await expect(
        service.findActiveOwnedOrFail(OWNER, 'conta-1'),
      ).resolves.toMatchObject({ id: 'conta-1' });
    });

    it('recusa conta inativa com 400', async () => {
      repository.findOwned.mockResolvedValue(conta({ active: false }));
      await expect(
        service.findActiveOwnedOrFail(OWNER, 'conta-1'),
      ).rejects.toThrow(new BadRequestException(CONTA_INATIVA));
    });

    it('dá 404 para conta de outro tenant', async () => {
      repository.findOwned.mockResolvedValue(null);
      await expect(
        service.findActiveOwnedOrFail(OUTRO_OWNER, 'conta-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
