import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { OnboardingController } from './onboarding.controller';

/**
 * Fixa a decisão de segurança central do módulo: `@RequirePermission()` sem
 * argumentos na classe é o opt-out deliberado (documentado no CLAUDE.md e no
 * comentário do controller) que mantém um colaborador com `permissions: []`
 * fora de um 403 no primeiro acesso — ele precisa ler o próprio estado e ver
 * o modal de boas-vindas antes de ter qualquer área liberada.
 *
 * Achado Important da revisão final: nada no repositório pinava essa
 * metadata. `permissions.guard.spec.ts` só cobria o branch `undefined` (sem
 * decorator); esta suíte não existia. Um "fail-closed em array vazio" futuro
 * no `PermissionsGuard` bloquearia as três rotas de onboarding para todo
 * mundo, com a suíte inteira verde. Molde: `surgery-requests.controller.spec.ts`.
 */
describe('Permissões declaradas no OnboardingController', () => {
  const reflector = new Reflector();

  it('usa o opt-out (array vazio) no controller inteiro', () => {
    expect(reflector.get(PERMISSIONS_KEY, OnboardingController)).toEqual([]);
  });
});
