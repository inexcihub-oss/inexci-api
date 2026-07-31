import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { ManufacturersController } from './manufacturers.controller';

describe('ManufacturersController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof ManufacturersController) =>
    reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      ManufacturersController.prototype[metodo],
    );

  it.each(['create', 'update', 'delete', 'bulkDelete'] as const)(
    'exige administração em %s',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
    },
  );

  it.each(['findAll', 'findOne'] as const)(
    'deixa %s aberto a qualquer autenticado',
    (metodo) => {
      expect(exigidoEm(metodo)).toBeUndefined();
    },
  );
});
