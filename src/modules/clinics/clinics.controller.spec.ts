import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS, Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { ClinicsController } from './clinics.controller';

describe('ClinicsController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof ClinicsController) =>
    reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      ClinicsController.prototype[metodo],
      ClinicsController,
    ]);

  it.each(['findAll', 'findOne', 'listRooms'] as const)(
    'libera a leitura em %s para qualquer área',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual(ALL_PERMISSIONS);
    },
  );

  it.each([
    'create',
    'update',
    'delete',
    'bulkDelete',
    'createRoom',
    'updateRoom',
    'deleteRoom',
  ] as const)('mantém %s em administração', (metodo) => {
    expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
  });

  it('nunca deixa rota sem exigência (colaborador sem área nenhuma)', () => {
    const metodos = [
      'findAll',
      'findOne',
      'create',
      'update',
      'delete',
      'bulkDelete',
      'listRooms',
      'createRoom',
      'updateRoom',
      'deleteRoom',
    ] as const;
    metodos.forEach((metodo) => {
      expect(exigidoEm(metodo)?.length).toBeGreaterThan(0);
    });
  });
});
