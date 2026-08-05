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

  it('não declara permissão na classe — paciente é cadastro transversal às quatro áreas, o recorte real é o ownerId', () => {
    expect(reflector.get(PERMISSIONS_KEY, PatientsController)).toBeUndefined();
  });

  it.each(['delete', 'bulkDelete'] as const)(
    'exige administração em %s',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
    },
  );

  it.each(['findAll', 'findOne', 'create', 'update'] as const)(
    'não exige nenhuma permissão de área em %s',
    (metodo) => {
      expect(exigidoEm(metodo)).toBeUndefined();
    },
  );
});
