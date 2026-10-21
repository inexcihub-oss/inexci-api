import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateFinancialAccountDto,
  FindFinancialAccountsDto,
  UpdateFinancialAccountDto,
} from './financial-account.dto';
import { UpdatePaymentMethodConfigDto } from './payment-method-config.dto';

async function erros<T extends object>(classe: new () => T, dados: object) {
  return (await validate(plainToInstance(classe, dados))).map(
    (e) => e.property,
  );
}

describe('DTOs do financeiro', () => {
  it('cria conta com nome aparado e tipo válido', async () => {
    const dto = plainToInstance(CreateFinancialAccountDto, {
      name: '  Caixa  ',
      type: 'cash_drawer',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.name).toBe('Caixa');
  });

  it('recusa nome vazio, longo demais e tipo fora do enum', async () => {
    expect(
      await erros(CreateFinancialAccountDto, { name: '   ', type: 'bank' }),
    ).toContain('name');
    expect(
      await erros(CreateFinancialAccountDto, {
        name: 'x'.repeat(81),
        type: 'bank',
      }),
    ).toContain('name');
    expect(
      await erros(CreateFinancialAccountDto, { name: 'A', type: 'cofre' }),
    ).toContain('type');
  });

  it('na edição aceita corpo vazio, mas não nome nulo', async () => {
    expect(await erros(UpdateFinancialAccountDto, {})).toEqual([]);
    expect(await erros(UpdateFinancialAccountDto, { name: null })).toContain(
      'name',
    );
  });

  it('converte includeInactive da query', () => {
    expect(
      plainToInstance(FindFinancialAccountsDto, { includeInactive: 'true' })
        .includeInactive,
    ).toBe(true);
    expect(
      plainToInstance(FindFinancialAccountsDto, { includeInactive: 'false' })
        .includeInactive,
    ).toBe(false);
  });

  describe('UpdatePaymentMethodConfigDto', () => {
    const valido = {
      active: true,
      defaultAccountId: null,
      maxInstallments: 1,
    };

    it('aceita conta nula', async () => {
      expect(await erros(UpdatePaymentMethodConfigDto, valido)).toEqual([]);
    });

    it('recusa id de conta inválido', async () => {
      expect(
        await erros(UpdatePaymentMethodConfigDto, {
          ...valido,
          defaultAccountId: 'abc',
        }),
      ).toContain('defaultAccountId');
    });

    it.each([0, 25, 2.5, '3'])('recusa %p parcelas', async (parcelas) => {
      expect(
        await erros(UpdatePaymentMethodConfigDto, {
          ...valido,
          maxInstallments: parcelas,
        }),
      ).toContain('maxInstallments');
    });

    it('exige active booleano', async () => {
      expect(
        await erros(UpdatePaymentMethodConfigDto, {
          ...valido,
          active: 'sim',
        }),
      ).toContain('active');
    });
  });
});
