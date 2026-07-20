import { Global, Module } from '@nestjs/common';
import { SurgeryRequestOwnerGuard } from './surgery-request-owner.guard';

/**
 * Disponibiliza o `SurgeryRequestOwnerGuard` globalmente para uso em
 * `@UseGuards(...)` nos controllers do módulo de solicitações cirúrgicas,
 * sem precisar registrá-lo em cada sub-módulo. Depende apenas do
 * `SurgeryRequestRepository` (DatabaseModule é @Global) e do `Reflector`.
 */
@Global()
@Module({
  providers: [SurgeryRequestOwnerGuard],
  exports: [SurgeryRequestOwnerGuard],
})
export class SurgeryRequestOwnerGuardModule {}
