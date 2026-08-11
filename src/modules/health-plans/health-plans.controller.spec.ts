import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS, Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { HealthPlansController } from './health-plans.controller';

/**
 * A exigência é lida do mesmo jeito que o `PermissionsGuard` lê:
 * `getAllAndOverride([método, classe])`. Olhar só o método esconderia o
 * `@RequireAnyArea()` da classe e faria uma rota parecer aberta a qualquer
 * autenticado quando na verdade exige ao menos uma área.
 */
describe('HealthPlansController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof HealthPlansController) =>
    reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      HealthPlansController.prototype[metodo],
      HealthPlansController,
    ]);

  it.each(['findAll', 'create', 'update'] as const)(
    'aceita qualquer área em %s',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual(ALL_PERMISSIONS);
    },
  );

  it.each(['delete', 'bulkDelete'] as const)(
    'mantém %s em administração',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
    },
  );

  it('nunca deixa a rota sem exigência (colaborador sem área nenhuma)', () => {
    const metodos = [
      'findAll',
      'create',
      'update',
      'delete',
      'bulkDelete',
    ] as const;
    metodos.forEach((metodo) => {
      expect(exigidoEm(metodo)?.length).toBeGreaterThan(0);
    });
  });
});
