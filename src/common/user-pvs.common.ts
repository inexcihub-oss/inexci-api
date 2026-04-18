import { UserRole } from 'src/database/entities/user.entity';

/**
 * Roles de usuário para controle de acesso
 *
 * Na nova arquitetura:
 * - ADMIN: Administrador da conta
 * - COLLABORATOR: Colaborador
 *
 * "Médico" não é um role — é definido pela existência de doctor_profile.
 */
export default {
  admin: UserRole.ADMIN,
  collaborator: UserRole.COLLABORATOR,
};

// Alias para compatibilidade
export const UserProfiles = {
  admin: UserRole.ADMIN,
  collaborator: UserRole.COLLABORATOR,
};
