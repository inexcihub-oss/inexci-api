import { Module } from '@nestjs/common';
import { SurgeryRequestFromIndicationService } from './surgery-request-from-indication.service';

/**
 * Módulo fino: o serviço não injeta nada (opera sobre o `EntityManager` do
 * chamador), então importá-lo não arrasta o grafo do `SurgeryRequestsModule`.
 */
@Module({
  providers: [SurgeryRequestFromIndicationService],
  exports: [SurgeryRequestFromIndicationService],
})
export class SurgeryRequestCreationModule {}
