import { Logger } from '@nestjs/common';
import { auditProntuarioAccess } from './audit';

describe('auditProntuarioAccess', () => {
  it('emits a structured prontuario_access event with actor and tenant', () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    auditProntuarioAccess({
      resource: 'surgery_request',
      resourceId: 'sr-1',
      action: 'GET',
      actorUserId: 'user-1',
      tenantId: 'owner-1',
    });

    expect(spy).toHaveBeenCalledWith({
      event: 'prontuario_access',
      resource: 'surgery_request',
      resourceId: 'sr-1',
      action: 'GET',
      actorUserId: 'user-1',
      tenantId: 'owner-1',
    });

    spy.mockRestore();
  });

  it('normalizes missing actor/tenant to null', () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    auditProntuarioAccess({
      resource: 'patient',
      resourceId: 'p-1',
      action: 'read',
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null, tenantId: null }),
    );

    spy.mockRestore();
  });
});
