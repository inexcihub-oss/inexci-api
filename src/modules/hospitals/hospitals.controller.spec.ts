import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { HospitalsController } from './hospitals.controller';

describe('HospitalsController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof HospitalsController) =>
    reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      HospitalsController.prototype[metodo],
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
