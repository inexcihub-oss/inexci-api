import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { PermissionsGuard } from 'src/shared/guards/permissions.guard';
import { ServicePricesController } from './service-prices.controller';

const METODOS = ['findAll', 'resolve', 'create', 'update', 'remove'] as const;

function handlerDe(metodo: (typeof METODOS)[number]) {
  return ServicePricesController.prototype[metodo] as () => unknown;
}

function contexto(
  metodo: (typeof METODOS)[number],
  permissions: Permission[],
): ExecutionContext {
  return {
    getHandler: () => handlerDe(metodo),
    getClass: () => ServicePricesController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { permissions } }),
    }),
  } as unknown as ExecutionContext;
}

describe('ServicePricesController', () => {
  const reflector = new Reflector();
  const guard = new PermissionsGuard(reflector);

  it('fica em /finance/service-prices', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ServicePricesController)).toBe(
      'finance/service-prices',
    );
  });

  it.each(METODOS)('%s exige só a área financeiro', (metodo) => {
    expect(
      reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        handlerDe(metodo),
        ServicePricesController,
      ]),
    ).toEqual([Permission.FINANCEIRO]);
  });

  it.each(METODOS)('%s responde 403 a quem tem as outras áreas', (metodo) => {
    expect(() =>
      guard.canActivate(
        contexto(metodo, [
          Permission.AGENDA,
          Permission.ATENDIMENTO,
          Permission.SOLICITACOES,
          Permission.ADMINISTRACAO,
        ]),
      ),
    ).toThrow(ForbiddenException);
  });

  it.each(METODOS)('%s libera quem tem financeiro', (metodo) => {
    expect(guard.canActivate(contexto(metodo, [Permission.FINANCEIRO]))).toBe(
      true,
    );
  });

  it('declara a rota resolve antes de :id', () => {
    const prototipo = ServicePricesController.prototype as unknown as Record<
      string,
      object
    >;
    const nomes = Object.getOwnPropertyNames(prototipo);

    expect(Reflect.getMetadata(PATH_METADATA, prototipo.resolve)).toBe(
      'resolve',
    );
    expect(nomes.indexOf('resolve')).toBeLessThan(nomes.indexOf('update'));
    expect(nomes.indexOf('resolve')).toBeLessThan(nomes.indexOf('remove'));
  });
});
