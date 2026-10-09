import { Reflector } from '@nestjs/core';
import {
  ALL_PERMISSIONS,
  Permission,
  resolveEffectivePermissions,
} from 'src/shared/permissions';
import { UserRole } from 'src/database/entities/user.entity';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { UsersController } from './users.controller';

describe('UsersController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof UsersController) =>
    reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      UsersController.prototype[metodo],
    );

  it('exige Administração, Solicitações OU Atendimento em updateDoctorProfile', () => {
    expect(exigidoEm('updateDoctorProfile')).toEqual([
      Permission.ADMINISTRACAO,
      Permission.SOLICITACOES,
      Permission.ATENDIMENTO,
    ]);
  });

  it('libera updateDoctorProfile para profissional não-CRM pelo guard', () => {
    const permissoesNutri = resolveEffectivePermissions({
      role: UserRole.COLLABORATOR,
      permissions: [],
      isDoctor: true,
      isPhysician: false,
    });
    expect(permissoesNutri).not.toContain(Permission.SOLICITACOES);
    expect(
      exigidoEm('updateDoctorProfile').some((p) => permissoesNutri.includes(p)),
    ).toBe(true);
  });

  it.each([
    'create',
    'findDoctors',
    'findCollaborators',
    'findCollaboratorById',
    'createCollaborator',
    'updateCollaborator',
    'toggleCollaboratorStatus',
    'resetCollaboratorPassword',
    'resendCollaboratorInvite',
    'deleteCollaborator',
    'bulkDeleteCollaborators',
    'getDoctorHeaderById',
    'upsertDoctorHeaderById',
    'deleteDoctorHeaderById',
  ] as const)('exige apenas Administração em %s', (metodo) => {
    expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
  });

  it.each(['findMany', 'findOne'] as const)(
    'não existe mais o método %s no controller',
    (metodo) => {
      expect(UsersController.prototype).not.toHaveProperty(metodo);
    },
  );

  it.each([
    'getProfile',
    'updateProfile',
    'updateProfileById',
    'getMyHeader',
    'upsertMyHeader',
    'deleteMyHeader',
  ] as const)(
    'não exige permissão em %s (rota do próprio usuário)',
    (metodo) => {
      expect(exigidoEm(metodo)).toBeUndefined();
    },
  );
});
