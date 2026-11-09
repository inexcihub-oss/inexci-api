import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SKIP_CONSENT_CHECK_KEY } from 'src/shared/guards/consents.guard';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { IS_PUBLIC_KEY } from 'src/shared/decorators/is-public.decorator';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import { AdminController } from '../admin.controller';
import { PlatformAuditController } from './platform-audit.controller';
import { PlatformAuditService } from './platform-audit.service';

describe('PlatformAuditController', () => {
  const service = { list: jest.fn() };
  const controller = new PlatformAuditController(
    service as unknown as PlatformAuditService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('aplica limite e deslocamento padrão e repassa os filtros', async () => {
    service.list.mockResolvedValue({ items: [], total: 0 });

    await controller.list({
      targetOwnerId: 'owner-1',
      action: PlatformAuditAction.COUPON_CREATED,
    });

    expect(service.list).toHaveBeenCalledWith({
      targetOwnerId: 'owner-1',
      actorAdminId: undefined,
      action: PlatformAuditAction.COUPON_CREATED,
      from: undefined,
      to: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it.each([PlatformAuditController, AdminController])(
    '%p usa a sessão do painel, é pública para o JWT da clínica e pula consentimento',
    (alvo) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, alvo)).toEqual([
        AdminSessionGuard,
      ]);
      expect(Reflect.getMetadata(SKIP_CONSENT_CHECK_KEY, alvo)).toBe(true);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, alvo)).toBe(true);
    },
  );
});
