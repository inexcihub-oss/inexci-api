import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS, Permission } from 'src/shared/permissions';
import { PermissionsGuard } from 'src/shared/guards/permissions.guard';

/**
 * Regressão da falha de controle de acesso: cadastros transversais (pacientes,
 * hospitais, convênios, fornecedores, procedimentos, fabricantes) ficavam sem
 * decorator, então um colaborador com `permissions: []` lia/escrevia toda a
 * base. `@RequireAnyArea()` exige ao menos uma das quatro áreas.
 */
function contextoCom(permissions: Permission[]): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as unknown as ExecutionContext;
}

describe('RequireAnyArea', () => {
  describe('efeito no PermissionsGuard', () => {
    let guard: PermissionsGuard;
    beforeEach(() => {
      const reflector = new Reflector();
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue([...ALL_PERMISSIONS]);
      guard = new PermissionsGuard(reflector);
    });

    it.each([
      Permission.AGENDA,
      Permission.ATENDIMENTO,
      Permission.SOLICITACOES,
      Permission.ADMINISTRACAO,
    ])('libera quem tem a área %s', (area) => {
      expect(guard.canActivate(contextoCom([area]))).toBe(true);
    });

    it('bloqueia colaborador sem permissão de área nenhuma (permissions: [])', () => {
      expect(() => guard.canActivate(contextoCom([]))).toThrow(
        ForbiddenException,
      );
    });
  });
});
