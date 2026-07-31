import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { PatientsController } from './patients.controller';

describe('PatientsController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof PatientsController) =>
    reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      PatientsController.prototype[metodo],
    );

  it.each(['delete', 'bulkDelete'] as const)(
    'exige administração em %s',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
    },
  );

  it.each(['findAll', 'findOne', 'create', 'update'] as const)(
    'não exige administração em %s (tratado na Tarefa 11)',
    (metodo) => {
      expect(exigidoEm(metodo)).toBeUndefined();
    },
  );
});
