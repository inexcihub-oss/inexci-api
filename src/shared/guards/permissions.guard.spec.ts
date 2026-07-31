import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PermissionsGuard } from './permissions.guard';

function contextoCom(permissions: Permission[] | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => (permissions === undefined ? {} : { user: { permissions } }),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let reflector: Reflector;
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  function exigir(permissions: Permission[] | undefined) {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(permissions);
  }

  it('libera rota sem decorator', () => {
    exigir(undefined);
    expect(guard.canActivate(contextoCom([]))).toBe(true);
  });

  it('libera quem tem a permissão exigida', () => {
    exigir([Permission.AGENDA]);
    expect(guard.canActivate(contextoCom([Permission.AGENDA]))).toBe(true);
  });

  it('bloqueia quem não tem', () => {
    exigir([Permission.SOLICITACOES]);
    expect(() => guard.canActivate(contextoCom([Permission.AGENDA]))).toThrow(
      ForbiddenException,
    );
  });

  /** Rotas compartilhadas: agenda e atendimento leem a mesma consulta. */
  it('basta uma das exigidas quando há várias', () => {
    exigir([Permission.AGENDA, Permission.ATENDIMENTO]);
    expect(guard.canActivate(contextoCom([Permission.ATENDIMENTO]))).toBe(true);
  });

  it('bloqueia quando não tem nenhuma das várias', () => {
    exigir([Permission.AGENDA, Permission.ATENDIMENTO]);
    expect(() =>
      guard.canActivate(contextoCom([Permission.SOLICITACOES])),
    ).toThrow(ForbiddenException);
  });

  /** Fail-closed: request sem user autenticado nunca passa numa rota com decorator. */
  it('bloqueia request sem usuário', () => {
    exigir([Permission.AGENDA]);
    expect(() => guard.canActivate(contextoCom(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
