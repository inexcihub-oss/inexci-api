import {
  ExecutionContext,
  ForbiddenException,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { UserRole } from 'src/database/entities/user.entity';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { PermissionsGuard } from 'src/shared/guards/permissions.guard';
import { CashSessionsService } from '../services/cash-sessions.service';
import { ReceivablesService } from '../services/receivables.service';
import { PaymentsService } from '../services/payments.service';
import {
  CashSessionsController,
  TransfersController,
} from './cash-sessions.controller';
import {
  FinanceAppointmentsController,
  FinancePatientsController,
} from './finance-appointments.controller';
import { PaymentsController } from './payments.controller';
import { ReceivablesController } from './receivables.controller';

type Controlador = abstract new (...args: never[]) => unknown;

const ROTAS: [string, Controlador, string][] = [
  ['ReceivablesController', ReceivablesController, 'findAll'],
  ['ReceivablesController', ReceivablesController, 'create'],
  ['ReceivablesController', ReceivablesController, 'createFromAppointment'],
  ['ReceivablesController', ReceivablesController, 'findOne'],
  ['ReceivablesController', ReceivablesController, 'addItem'],
  ['ReceivablesController', ReceivablesController, 'cancelItem'],
  ['ReceivablesController', ReceivablesController, 'cancel'],
  ['ReceivablesController', ReceivablesController, 'registerPayment'],
  ['PaymentsController', PaymentsController, 'findAll'],
  ['PaymentsController', PaymentsController, 'refund'],
  ['FinanceAppointmentsController', FinanceAppointmentsController, 'status'],
  ['FinancePatientsController', FinancePatientsController, 'summary'],
  ['CashSessionsController', CashSessionsController, 'current'],
  ['CashSessionsController', CashSessionsController, 'open'],
  ['CashSessionsController', CashSessionsController, 'withdraw'],
  ['CashSessionsController', CashSessionsController, 'supply'],
  ['CashSessionsController', CashSessionsController, 'closeCurrent'],
  ['CashSessionsController', CashSessionsController, 'list'],
  ['CashSessionsController', CashSessionsController, 'findOne'],
  ['CashSessionsController', CashSessionsController, 'report'],
  ['CashSessionsController', CashSessionsController, 'close'],
  ['TransfersController', TransfersController, 'transfer'],
];

function handlerDe(controlador: Controlador, metodo: string) {
  return (controlador.prototype as Record<string, () => unknown>)[metodo];
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

function rotasNaOrdem(controlador: Controlador): string[] {
  return Object.getOwnPropertyNames(controlador.prototype)
    .filter((nome) => nome !== 'constructor')
    .map(
      (nome) =>
        Reflect.getMetadata(PATH_METADATA, handlerDe(controlador, nome)) as
          | string
          | undefined,
    )
    .filter((rota): rota is string => rota !== undefined);
}

describe('controllers de cobrança, pagamento e caixa', () => {
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

  it.each(ROTAS)(
    '%s.%s libera quem tem financeiro',
    (_n, controlador, metodo) => {
      expect(
        guard.canActivate(
          contexto(controlador, metodo, [Permission.FINANCEIRO]),
        ),
      ).toBe(true);
    },
  );

  it('registra as rotas fixas antes de :id', () => {
    const caixa = rotasNaOrdem(CashSessionsController);
    expect(caixa.indexOf('current')).toBeLessThan(caixa.indexOf(':id'));
    expect(caixa.indexOf(':id/report')).toBeLessThan(caixa.indexOf(':id'));
    const cobrancas = rotasNaOrdem(ReceivablesController);
    expect(cobrancas.indexOf('from-appointment/:appointmentId')).toBeLessThan(
      cobrancas.indexOf(':id'),
    );
  });

  describe('repasse ao service', () => {
    const user = {
      userId: 'user-1',
      ownerId: 'owner-1',
      role: UserRole.COLLABORATOR,
      permissions: [Permission.FINANCEIRO],
    };

    it('relatório do caixa devolve JSON ou CSV', async () => {
      const service = {
        summaryFor: jest.fn().mockResolvedValue({ id: 'caixa-1' }),
        reportCsv: jest.fn().mockResolvedValue('Seção\r\n'),
      };
      const controller = new CashSessionsController(
        service as unknown as CashSessionsService,
      );
      await expect(controller.report('caixa-1', {}, user)).resolves.toEqual({
        id: 'caixa-1',
      });
      expect(service.summaryFor).toHaveBeenCalledWith(user, 'caixa-1');
      const arquivo = await controller.report(
        'caixa-1',
        { format: 'csv' },
        user,
      );
      expect(arquivo).toBeInstanceOf(StreamableFile);
      expect((arquivo as StreamableFile).getHeaders()).toMatchObject({
        type: 'text/csv; charset=utf-8',
        disposition: 'attachment; filename="caixa-caixa-1.csv"',
      });
      expect(service.reportCsv).toHaveBeenCalledWith(user, 'caixa-1');
    });

    it('cobrança e pagamento usam o ownerId do usuário', async () => {
      const receivables = {
        createFromAppointment: jest.fn().mockResolvedValue({}),
      };
      const payments = { register: jest.fn().mockResolvedValue({}) };
      const controller = new ReceivablesController(
        receivables as unknown as ReceivablesService,
        payments as unknown as PaymentsService,
      );
      await controller.createFromAppointment('consulta-1', {}, user);
      expect(receivables.createFromAppointment).toHaveBeenCalledWith(
        'owner-1',
        'user-1',
        'consulta-1',
        { allowHealthPlan: false, unitAmount: undefined },
      );
      await controller.createFromAppointment(
        'consulta-1',
        { allowHealthPlan: true, unitAmount: '180.00' },
        user,
      );
      expect(receivables.createFromAppointment).toHaveBeenLastCalledWith(
        'owner-1',
        'user-1',
        'consulta-1',
        { allowHealthPlan: true, unitAmount: '180.00' },
      );
      await controller.registerPayment('cobranca-1', { lines: [] }, user);
      expect(payments.register).toHaveBeenCalledWith(
        'owner-1',
        'user-1',
        'cobranca-1',
        { lines: [] },
        [Permission.FINANCEIRO],
      );
    });
  });
});
