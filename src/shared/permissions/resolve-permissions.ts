import { UserRole } from 'src/database/entities/user.entity';
import { ALL_PERMISSIONS, Permission } from './permission.enum';

export interface PermissionSubject {
  role: UserRole;
  permissions?: Permission[] | null;
  /** Existência de `doctor_profile` — "médico" não é um role. */
  isDoctor: boolean;
}

/**
 * Traduz o que está gravado no banco na permissão que de fato vale.
 *
 * O dono da conta recebe tudo: restringir quem paga a assinatura não faz
 * sentido. E quem tem `doctor_profile` recebe Atendimento e Solicitações por
 * cima do array, porque finalizar uma ficha com indicação cirúrgica abre a SC —
 * um médico sem Solicitações criaria uma solicitação invisível para si mesmo.
 *
 * Derivar em vez de gravar evita o estado corrompido de promover alguém a
 * médico depois e o array ficar desatualizado.
 */
export function resolveEffectivePermissions(
  subject: PermissionSubject,
): Permission[] {
  if (subject.role === UserRole.ADMIN) return [...ALL_PERMISSIONS];

  const concedidas = new Set<Permission>(subject.permissions ?? []);
  if (subject.isDoctor) {
    concedidas.add(Permission.ATENDIMENTO);
    concedidas.add(Permission.SOLICITACOES);
  }

  // Filtrar por ALL_PERMISSIONS fixa a ordem e descarta valor estranho que
  // tenha entrado no text[] por fora da aplicação.
  return ALL_PERMISSIONS.filter((p) => concedidas.has(p));
}
