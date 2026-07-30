import { NotificationsModule } from 'src/modules/notifications/notifications.module';
import { SurgeryRequestRealtimeModule } from './surgery-request-realtime.module';
import { SurgeryRequestRealtimeService } from './surgery-request-realtime.service';

/**
 * `SurgeryRequestRealtimeService` recebe o `NotificationsGateway` como
 * `@Optional()`. Sem o `NotificationsModule` importado aqui, o gateway fica
 * undefined, `broadcastChange` retorna cedo EM SILÊNCIO e o kanban simplesmente
 * nunca atualiza — falha que nenhum teste de comportamento pegaria.
 */
describe('SurgeryRequestRealtimeModule', () => {
  it('importa o NotificationsModule para o gateway resolver', () => {
    const imports: unknown[] =
      Reflect.getMetadata('imports', SurgeryRequestRealtimeModule) ?? [];
    expect(imports).toContain(NotificationsModule);
  });

  it('exporta o serviço de realtime', () => {
    const exports: unknown[] =
      Reflect.getMetadata('exports', SurgeryRequestRealtimeModule) ?? [];
    expect(exports).toContain(SurgeryRequestRealtimeService);
  });
});
