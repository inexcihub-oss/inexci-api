import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS, Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { ClinicsController } from './clinics.controller';

/**
 * A exigência é lida como o `PermissionsGuard` lê:
 * `getAllAndOverride([método, classe])`. Olhar só o método esconderia o
 * decorator de classe e faria a rota parecer aberta.
 */
describe('ClinicsController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof ClinicsController) =>
    reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      ClinicsController.prototype[metodo],
      ClinicsController,
    ]);

  it.each(['findAll', 'findOne'] as const)(
    'libera a leitura em %s para qualquer área',
    (metodo) => {
      // Quem só tem Agenda precisa ler a lista para preencher o seletor do
      // modal de consulta e calcular o aviso de horário — mas não cadastra.
      expect(exigidoEm(metodo)).toEqual(ALL_PERMISSIONS);
    },
  );

  it.each(['create', 'update', 'delete', 'bulkDelete'] as const)(
    'mantém %s em administração',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
    },
  );

  it('nunca deixa rota sem exigência (colaborador sem área nenhuma)', () => {
    const metodos = [
      'findAll',
      'findOne',
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
