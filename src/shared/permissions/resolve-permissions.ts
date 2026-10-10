import { UserRole } from 'src/database/entities/user.entity';
import { isPhysicianProfile } from 'src/database/entities/doctor-profile.entity';
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

export interface UserWithProfileLike {
  role: UserRole;
  permissions?: Permission[] | null;
  doctorProfile?: { council?: string | null } | null;
}

export function permissionsOf(user: UserWithProfileLike): Permission[] {
  return resolveEffectivePermissions({
    role: user.role,
    permissions: user.permissions,
    isDoctor: !!user.doctorProfile,
    isPhysician: isPhysicianProfile(user.doctorProfile),
  });
}

export function canAdministrate(user: UserWithProfileLike): boolean {
  return permissionsOf(user).includes(Permission.ADMINISTRACAO);
}
