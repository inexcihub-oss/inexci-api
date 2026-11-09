import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from 'src/shared/decorators/is-public.decorator';
import { SKIP_CONSENT_CHECK_KEY } from 'src/shared/guards/consents.guard';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { AdminTeamController } from './admin-team.controller';
import { AdminTeamService } from './admin-team.service';

describe('AdminTeamController', () => {
  const service = {
    list: jest.fn(),
    create: jest.fn(),
    revoke: jest.fn(),
    resetAccess: jest.fn(),
  };
  const controller = new AdminTeamController(
    service as unknown as AdminTeamService,
  );
  const admin = { adminId: 'actor-1', name: 'Ana', email: 'ana@inexci.com' };

  beforeEach(() => jest.clearAllMocks());

  it('usa a sessão do painel e pula o JWT e o consentimento da clínica', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminTeamController)).toEqual([
      AdminSessionGuard,
    ]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminTeamController)).toBe(true);
    expect(
      Reflect.getMetadata(SKIP_CONSENT_CHECK_KEY, AdminTeamController),
    ).toBe(true);
  });

  it('repassa o administrador da sessão às ações', async () => {
    await controller.create({ name: 'Bia', email: 'b@x.com' }, admin);
    await controller.revoke('id-1', { reason: 'motivo ok' }, admin);
    await controller.resetAccess('id-2', { reason: 'motivo ok' }, admin);

    expect(service.create).toHaveBeenCalledWith(
      { name: 'Bia', email: 'b@x.com' },
      'actor-1',
    );
    expect(service.revoke).toHaveBeenCalledWith(
      'id-1',
      { reason: 'motivo ok' },
      'actor-1',
    );
    expect(service.resetAccess).toHaveBeenCalledWith(
      'id-2',
      { reason: 'motivo ok' },
      'actor-1',
    );
  });
});
