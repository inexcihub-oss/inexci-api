import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { HealthPlansController } from './health-plans.controller';

describe('HealthPlansController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof HealthPlansController) =>
    reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      HealthPlansController.prototype[metodo],
    );

  it.each(['create', 'update', 'delete', 'bulkDelete'] as const)(
    'exige administração em %s',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
    },
  );

  it('deixa a listagem aberta a qualquer autenticado', () => {
    expect(exigidoEm('findAll')).toBeUndefined();
  });
});
