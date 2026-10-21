import {
  ExecutionContext,
  ForbiddenException,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from 'src/database/entities/user.entity';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { PermissionsGuard } from 'src/shared/guards/permissions.guard';
import { AuthenticatedUser } from 'src/shared/decorators/current-user.decorator';
import { FinanceReportsService } from '../services/finance-reports.service';
import { AccountStatementService } from '../services/account-statement.service';
import { PaymentReceiptService } from '../services/payment-receipt.service';
import { FinanceReportsController } from './finance-reports.controller';
import { AccountStatementController } from './account-statement.controller';
import { PaymentReceiptController } from './payment-receipt.controller';

type Controlador =
  | typeof FinanceReportsController
  | typeof AccountStatementController
  | typeof PaymentReceiptController;

const ROTAS: [string, Controlador, string][] = [
  ['FinanceReportsController', FinanceReportsController, 'receipts'],
  ['FinanceReportsController', FinanceReportsController, 'production'],
  ['FinanceReportsController', FinanceReportsController, 'open'],
  ['AccountStatementController', AccountStatementController, 'statement'],
  ['PaymentReceiptController', PaymentReceiptController, 'receipt'],
  ['PaymentReceiptController', PaymentReceiptController, 'preview'],
];

function handlerDe(controlador: Controlador, metodo: string) {
  return (controlador.prototype as unknown as Record<string, () => unknown>)[
    metodo
  ];
}

function contexto(
  controlador: Controlador,
  metodo: string,
  permissions: Permission[],
): ExecutionContext {
  return {
    getHandler: () => handlerDe(controlador, metodo),
    getClass: () => controlador,
    switchToHttp: () => ({
      getRequest: () => ({ user: { permissions } }),
    }),
  } as unknown as ExecutionContext;
}

const colaborador: AuthenticatedUser = {
  userId: 'colab-1',
  ownerId: 'owner-1',
  role: UserRole.COLLABORATOR,
  permissions: [Permission.FINANCEIRO],
};

describe('relatórios e recibo — permissões', () => {
  const reflector = new Reflector();
  const guard = new PermissionsGuard(reflector);

  it.each(ROTAS)(
    '%s.%s exige só a área financeiro',
    (_n, controlador, metodo) => {
      expect(
        reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
          handlerDe(controlador, metodo),
          controlador,
        ]),
      ).toEqual([Permission.FINANCEIRO]);
    },
  );

  it.each(ROTAS)(
    '%s.%s responde 403 a quem tem todas as outras áreas',
    (_n, controlador, metodo) => {
      expect(() =>
        guard.canActivate(
          contexto(controlador, metodo, [
            Permission.AGENDA,
            Permission.ATENDIMENTO,
            Permission.SOLICITACOES,
            Permission.ADMINISTRACAO,
          ]),
        ),
      ).toThrow(ForbiddenException);
    },
  );
});

describe('FinanceReportsController', () => {
  const relatorio = {
    groupBy: 'day' as const,
    rows: [],
    totals: { received: '0.00', refunded: '0.00', net: '0.00', count: 0 },
  };

  function montar() {
    const service = {
      receipts: jest.fn().mockResolvedValue(relatorio),
      receiptsCsv: jest.fn().mockReturnValue('Dia;Recebido\r\n'),
      production: jest.fn().mockResolvedValue({ rows: [], totals: {} }),
      productionCsv: jest.fn().mockReturnValue('csv'),
      open: jest.fn().mockResolvedValue({ rows: [], totals: {} }),
      openCsv: jest.fn().mockReturnValue('csv'),
    };
    return {
      service,
      controller: new FinanceReportsController(
        service as unknown as FinanceReportsService,
      ),
    };
  }

  it('repassa o tenant e devolve JSON por padrão', async () => {
    const { service, controller } = montar();
    const resposta = await controller.receipts(
      { from: '2026-10-01', to: '2026-10-31', groupBy: 'day' },
      colaborador,
    );
    expect(resposta).toBe(relatorio);
    expect(service.receipts).toHaveBeenCalledWith(
      'owner-1',
      { from: '2026-10-01', to: '2026-10-31' },
      'day',
    );
  });

  it('format=csv devolve arquivo com content-type e nome', async () => {
    const { controller } = montar();
    const resposta = await controller.receipts(
      {
        from: '2026-10-01',
        to: '2026-10-31',
        groupBy: 'method',
        format: 'csv',
      },
      colaborador,
    );
    expect(resposta).toBeInstanceOf(StreamableFile);
    const headers = (resposta as StreamableFile).getHeaders();
    expect(headers.type).toBe('text/csv; charset=utf-8');
    expect(headers.disposition).toBe(
      'attachment; filename="recebimentos-method-2026-10-01-2026-10-31.csv"',
    );
  });

  it('produção e em aberto também exportam CSV', async () => {
    const { service, controller } = montar();
    await expect(
      controller.production(
        { from: '2026-10-01', to: '2026-10-31', format: 'csv' },
        colaborador,
      ),
    ).resolves.toBeInstanceOf(StreamableFile);
    await expect(
      controller.open({ format: 'csv' }, colaborador),
    ).resolves.toBeInstanceOf(StreamableFile);
    expect(service.open).toHaveBeenCalledWith('owner-1', { until: undefined });
  });
});

describe('AccountStatementController', () => {
  it('repassa tenant, conta e período', async () => {
    const extrato = {
      account: { id: 'c-1', name: 'Caixa Físico', type: 'cash_drawer' },
      openingBalance: '0.00',
      closingBalance: '0.00',
      entries: [],
    };
    const service = {
      statement: jest.fn().mockResolvedValue(extrato),
      statementCsv: jest.fn().mockReturnValue('csv'),
    };
    const controller = new AccountStatementController(
      service as unknown as AccountStatementService,
    );

    await expect(
      controller.statement(
        'c-1',
        { from: '2026-10-01', to: '2026-10-31' },
        colaborador,
      ),
    ).resolves.toBe(extrato);
    expect(service.statement).toHaveBeenCalledWith('owner-1', 'c-1', {
      from: '2026-10-01',
      to: '2026-10-31',
    });

    const arquivo = await controller.statement(
      'c-1',
      { from: '2026-10-01', to: '2026-10-31', format: 'csv' },
      colaborador,
    );
    expect((arquivo as StreamableFile).getHeaders().disposition).toBe(
      'attachment; filename="extrato-Caixa_F_sico-2026-10-01-2026-10-31.csv"',
    );
  });
});

describe('PaymentReceiptController', () => {
  it('devolve PDF inline e prévia em HTML, sempre pelo tenant', async () => {
    const service = {
      pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
      preview: jest.fn().mockResolvedValue('<html></html>'),
    };
    const controller = new PaymentReceiptController(
      service as unknown as PaymentReceiptService,
    );

    const arquivo = await controller.receipt('pay-1', colaborador);
    expect(arquivo.getHeaders()).toEqual({
      type: 'application/pdf',
      disposition: 'inline; filename="recibo-pay-1.pdf"',
      length: 4,
    });
    expect(service.pdf).toHaveBeenCalledWith('owner-1', 'colab-1', 'pay-1');

    await expect(controller.preview('pay-1', colaborador)).resolves.toEqual({
      html: '<html></html>',
    });
    expect(service.preview).toHaveBeenCalledWith('owner-1', 'colab-1', 'pay-1');
  });
});
