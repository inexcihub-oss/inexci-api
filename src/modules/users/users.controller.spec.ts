import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS, Permission } from 'src/shared/permissions';
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
   * PATCH doctor-profile/:id (assinatura/CRM de perfil médico de terceiro) é
   * a ÚNICA das 4 rotas de perfil médico/cabeçalho de terceiro que precisa
   * das duas permissões: o editor de laudo (MedicalReportEditor.tsx:315,336)
   * a usa para o colaborador vinculado ao médico da solicitação (que tem
   * Solicitações, não Administração) subir/remover só a assinatura. A
   * restrição fina (vínculo colaborador↔médico, campo permitido) continua em
   * UsersService.updateDoctorProfileById.
   */
  it('exige Administração OU Solicitações em updateDoctorProfile', () => {
    expect(exigidoEm('updateDoctorProfile')).toEqual([
      Permission.ADMINISTRACAO,
      Permission.SOLICITACOES,
    ]);
  });

  /**
   * As 3 rotas de cabeçalho "por id" (diferente de `/users/me/header`) NÃO
   * são usadas pelo editor de laudo — ele lê/grava o cabeçalho do PRÓPRIO
   * usuário (`isOwnRequest` em MedicalReportEditor.tsx:351-357). Só o admin
   * da conta configura cabeçalho de outro médico (ex.:
   * `colaboradores/assistente/[id]`), então aqui é só Administração.
   */
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

  // Diretório do staff (nome/e-mail/CPF/telefone dos colegas): antes liberado a
  // qualquer autenticado, agora exige ao menos uma área (RequireAnyArea) — o
  // service continua escopando por ownerId/vínculo.
  it.each(['findMany', 'findOne'] as const)(
    'exige ao menos uma área em %s (RequireAnyArea)',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual([...ALL_PERMISSIONS]);
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
