import { SetMetadata } from '@nestjs/common';
import { Permission } from 'src/shared/permissions';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Exige do usuário **qualquer uma** das permissões informadas.
 *
 * Aplicado no método, sobrescreve o da classe — é assim que
 * `AppointmentsController` exige Agenda na classe e libera a leitura
 * (`findAgenda`, `findByPatient`, `findOne`) também para quem só tem
 * Atendimento. `@RequirePermission()` sem argumentos é o opt-out: em
 * `SurgeryRequestsController`, a classe exige Solicitações, mas
 * `available-doctors` usa a lista vazia para se abrir a qualquer
 * autenticado.
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
