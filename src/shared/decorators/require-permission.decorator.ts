import { SetMetadata } from '@nestjs/common';
import { Permission } from 'src/shared/permissions';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Exige do usuário **qualquer uma** das permissões informadas.
 *
 * Aplicado no método, sobrescreve o da classe — é assim que
 * `PatientsController` exige Atendimento ou Solicitações no geral e
 * Administração só no `DELETE`.
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
