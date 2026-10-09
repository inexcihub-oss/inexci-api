import { UserRole } from 'src/database/entities/user.entity';
import { ALL_PERMISSIONS, Permission } from './permission.enum';

export interface PermissionSubject {
  role: UserRole;
  permissions?: Permission[] | null;
  isDoctor: boolean;
  isPhysician: boolean;
}

export function resolveEffectivePermissions(
  subject: PermissionSubject,
): Permission[] {
  if (subject.role === UserRole.ADMIN) return [...ALL_PERMISSIONS];

  const concedidas = new Set<Permission>(subject.permissions ?? []);
  if (subject.isDoctor) {
    concedidas.add(Permission.AGENDA);
    concedidas.add(Permission.ATENDIMENTO);
  }
  if (subject.isDoctor && subject.isPhysician) {
    concedidas.add(Permission.SOLICITACOES);
  }

  return ALL_PERMISSIONS.filter((p) => concedidas.has(p));
}
