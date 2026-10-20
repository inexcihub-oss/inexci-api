import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS, Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { ProceduresController } from './procedures.controller';

describe('ProceduresController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof ProceduresController) =>
    reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      ProceduresController.prototype[metodo],
      ProceduresController,
    ]);

  it.each(['findAll', 'findOne', 'create', 'update'] as const)(
    'aceita qualquer área em %s',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual(ALL_PERMISSIONS);
    },
  );

  it('mantém delete em administração', () => {
    expect(exigidoEm('delete')).toEqual([Permission.ADMINISTRACAO]);
  });

  it('nunca deixa a rota sem exigência (colaborador sem área nenhuma)', () => {
    const metodos = [
      'findAll',
      'findOne',
      'create',
      'update',
      'delete',
    ] as const;
    metodos.forEach((metodo) => {
      expect(exigidoEm(metodo)?.length).toBeGreaterThan(0);
    });
  });
});
