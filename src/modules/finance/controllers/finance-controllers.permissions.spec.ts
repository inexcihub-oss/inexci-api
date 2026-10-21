import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { PermissionsGuard } from 'src/shared/guards/permissions.guard';
import { AccountsController } from './accounts.controller';
import { PaymentMethodsController } from './payment-methods.controller';
import { FinanceProfessionalsController } from './finance-appointments.controller';

type Controlador =
  | typeof AccountsController
  | typeof PaymentMethodsController
  | typeof FinanceProfessionalsController;

const ROTAS: [string, Controlador, string][] = [
  ['AccountsController', AccountsController, 'findAll'],
  ['AccountsController', AccountsController, 'create'],
  ['AccountsController', AccountsController, 'update'],
  ['AccountsController', AccountsController, 'updateStatus'],
  ['PaymentMethodsController', PaymentMethodsController, 'findAll'],
  ['PaymentMethodsController', PaymentMethodsController, 'update'],
  ['FinanceProfessionalsController', FinanceProfessionalsController, 'list'],
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

describe('controllers do financeiro — permissões', () => {
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
});
