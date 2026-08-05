import { Module } from '@nestjs/common';
import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { SurgeryRequestRealtimeService } from './surgery-request-realtime.service';

/**
 * Módulo fino só com o broadcaster de mudanças de SC, para que qualquer módulo
 * possa emitir o evento do kanban sem importar o `SurgeryRequestsModule`
 * inteiro (que traz AiModule, PdfModule e as filas Bull).
 *
 * O `NotificationsModule` é obrigatório aqui: os dois deps do serviço são
 * `@Optional()`, então sem ele o broadcast falha em silêncio.
 */
@Module({
  imports: [NotificationsModule],
  providers: [SurgeryRequestRealtimeService],
  exports: [SurgeryRequestRealtimeService],
})
export class SurgeryRequestRealtimeModule {}
