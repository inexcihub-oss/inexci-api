import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { UsersController } from './users.controller';

describe('UsersController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof UsersController) =>
    reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      UsersController.prototype[metodo],
    );

  /**
   * Estas 4 rotas editam perfil médico / cabeçalho de OUTRO usuário, mas o
   * editor de laudo (MedicalReportEditor) as usa também para o colaborador
   * vinculado ao médico da solicitação — que tem Solicitações, não
   * Administração. Por isso "qualquer uma das duas", nunca só Administração
   * (isso quebraria o fluxo de laudo). A restrição fina (vínculo
   * colaborador↔médico, campo de assinatura) continua no service.
   */
  it.each([
    'updateDoctorProfile',
    'getDoctorHeaderById',
    'upsertDoctorHeaderById',
    'deleteDoctorHeaderById',
  ] as const)('exige Administração OU Solicitações em %s', (metodo) => {
    expect(exigidoEm(metodo)).toEqual([
      Permission.ADMINISTRACAO,
      Permission.SOLICITACOES,
    ]);
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
  ] as const)('exige apenas Administração em %s', (metodo) => {
    expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
  });

  it.each([
    'findMany',
    'findOne',
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
