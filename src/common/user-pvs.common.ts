import { UserRole } from 'src/database/entities/user.entity';

/**
 * Roles de usuário para controle de acesso
 *
 * Na nova arquitetura:
 * - ADMIN: Administrador da plataforma
 * - DOCTOR: Médico (dono da conta)
 * - COLLABORATOR: Colaborador do médico
 *
 * Hospital, Patient, Supplier e HealthPlan são entidades de negócio
 * que não fazem login no sistema.
 */
export default {
  admin: UserRole.ADMIN,
  doctor: UserRole.DOCTOR,
  collaborator: UserRole.COLLABORATOR,
};

// Alias para compatibilidade
export const UserProfiles = {
  admin: UserRole.ADMIN,
  doctor: UserRole.DOCTOR,
  collaborator: UserRole.COLLABORATOR,
};

// Mapeamento legado para transição (será removido futuramente)
export const LegacyUserPvs = {
  doctor: 1,
  collaborator: 2,
  hospital: 3,
  patient: 4,
  supplier: 5,
  health_plan: 6,
};
