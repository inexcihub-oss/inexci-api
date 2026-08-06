import { SetMetadata } from '@nestjs/common';
import { ALL_PERMISSIONS, Permission } from 'src/shared/permissions';

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

/**
 * Exige **qualquer uma** das quatro áreas da plataforma — ou seja, qualquer
 * usuário que tenha acesso a pelo menos uma área.
 *
 * Usado nos cadastros transversais (pacientes, hospitais, convênios,
 * fornecedores, procedimentos, fabricantes): eles são compartilhados por
 * Agenda, Atendimento, Solicitações e Administração, então não faz sentido
 * amarrá-los a uma única área. Mas sem decorator nenhum a rota fica liberada a
 * QUALQUER autenticado — inclusive um colaborador criado com `permissions: []`
 * ("sem acesso a área nenhuma"), que passava a ler/escrever toda a base de
 * pacientes (dado de saúde, LGPD art. 11). `RequireAnyArea` mantém a
 * transversalidade e fecha esse buraco: zero-permissão ⇒ 403.
 */
export const RequireAnyArea = () =>
  SetMetadata(PERMISSIONS_KEY, [...ALL_PERMISSIONS]);
