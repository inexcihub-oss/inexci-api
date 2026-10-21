import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CloseCashSessionDto, TransferDto } from './cash-session.dto';
import { RegisterPaymentDto } from './payment.dto';
import {
  CreateReceivableDto,
  CreateReceivableFromAppointmentDto,
  FindAppointmentsFinanceStatusDto,
} from './receivable.dto';

const UUID = '00000000-0000-4000-8000-000000000001';

function erros<T extends object>(classe: new () => T, dados: object) {
  return validateSync(plainToInstance(classe, dados) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('DTOs de cobrança, pagamento e caixa', () => {
  it.each(['10', '10.5', '10.50', '0', '9999999999.99'])(
    'aceita o valor monetário %p',
    (valor) => {
      expect(erros(CloseCashSessionDto, { countedAmount: valor })).toHaveLength(
        0,
      );
    },
  );

  it.each(['-1.00', '1.234', '1,50', '.5', '', 'abc', '10000000000.00'])(
    'recusa o valor monetário %p',
    (valor) => {
      expect(
        erros(CloseCashSessionDto, { countedAmount: valor }),
      ).not.toHaveLength(0);
    },
  );

  it('cobrança pela consulta aceita unitAmount opcional e valida o formato', () => {
    expect(erros(CreateReceivableFromAppointmentDto, {})).toHaveLength(0);
    expect(
      erros(CreateReceivableFromAppointmentDto, {
        allowHealthPlan: true,
        unitAmount: '180.00',
      }),
    ).toHaveLength(0);
    expect(
      erros(CreateReceivableFromAppointmentDto, { unitAmount: '-5.00' }),
    ).not.toHaveLength(0);
  });

  it('pagamento aceita idempotencyKey uuid e recusa outro formato', () => {
    const linhas = [{ method: 'pix', amount: '10.00' }];
    expect(
      erros(RegisterPaymentDto, { lines: linhas, idempotencyKey: UUID }),
    ).toHaveLength(0);
    expect(
      erros(RegisterPaymentDto, { lines: linhas, idempotencyKey: 'abc' }),
    ).not.toHaveLength(0);
  });

  it('recusa valor numérico em vez de string decimal', () => {
    expect(erros(CloseCashSessionDto, { countedAmount: 10 })).not.toHaveLength(
      0,
    );
  });

  it('cobrança exige ao menos um item válido e rejeita campos extras', () => {
    expect(
      erros(CreateReceivableDto, { patientId: UUID, items: [] }),
    ).not.toHaveLength(0);
    expect(
      erros(CreateReceivableDto, {
        patientId: UUID,
        items: [{ description: 'Consulta', unitAmount: '100.00' }],
      }),
    ).toHaveLength(0);
    expect(
      erros(CreateReceivableDto, {
        patientId: UUID,
        ownerId: UUID,
        items: [{ description: 'Consulta', unitAmount: '100.00' }],
      }),
    ).not.toHaveLength(0);
    expect(
      erros(CreateReceivableDto, {
        patientId: UUID,
        items: [{ description: 'Consulta', unitAmount: '100.00', quantity: 0 }],
      }),
    ).not.toHaveLength(0);
  });

  it('pagamento valida forma e parcelas', () => {
    expect(
      erros(RegisterPaymentDto, {
        lines: [{ method: 'credit_card', amount: '50.00', installments: 3 }],
      }),
    ).toHaveLength(0);
    expect(
      erros(RegisterPaymentDto, {
        lines: [{ method: 'bitcoin', amount: '50.00' }],
      }),
    ).not.toHaveLength(0);
    expect(
      erros(RegisterPaymentDto, {
        lines: [{ method: 'pix', amount: '50.00', installments: 25 }],
      }),
    ).not.toHaveLength(0);
  });

  it('ids das consultas: separa por vírgula e limita a 200', () => {
    const dto = plainToInstance(FindAppointmentsFinanceStatusDto, {
      ids: `${UUID}, ${UUID}`,
    });
    expect(dto.ids).toEqual([UUID, UUID]);
    expect(validateSync(dto)).toHaveLength(0);
    expect(
      erros(FindAppointmentsFinanceStatusDto, {
        ids: Array(201).fill(UUID).join(','),
      }),
    ).not.toHaveLength(0);
    expect(
      erros(FindAppointmentsFinanceStatusDto, { ids: 'nao-e-uuid' }),
    ).not.toHaveLength(0);
  });

  it('transferência exige contas válidas', () => {
    expect(
      erros(TransferDto, {
        fromAccountId: UUID,
        toAccountId: UUID,
        amount: '10.00',
      }),
    ).toHaveLength(0);
    expect(
      erros(TransferDto, {
        fromAccountId: 'x',
        toAccountId: UUID,
        amount: '1',
      }),
    ).not.toHaveLength(0);
  });
});
