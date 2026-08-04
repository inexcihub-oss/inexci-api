import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SurgeryRequestOwnerGuard } from './surgery-request-owner.guard';

function makeCtx(req: any): any {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
}

describe('SurgeryRequestOwnerGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;

  function makeGuard(
    sr: { ownerId: string; doctorId?: string } | null,
    canAccessDoctor: boolean | jest.Mock = true,
  ) {
    const repo = {
      findOneSimple: jest.fn().mockResolvedValue(sr),
    };
    const accessControl = {
      canAccessDoctor:
        typeof canAccessDoctor === 'function'
          ? canAccessDoctor
          : jest.fn().mockResolvedValue(canAccessDoctor),
    };
    return {
      guard: new SurgeryRequestOwnerGuard(
        reflector,
        repo as never,
        accessControl as never,
      ),
      repo,
      accessControl,
    };
  }

  beforeEach(() => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
  });

  it('bloqueia acesso cross-tenant (403)', async () => {
    const { guard } = makeGuard({ ownerId: 'clinica-B', doctorId: 'medico-1' });
    const ctx = makeCtx({
      params: { id: 'sc-de-B' },
      user: { userId: 'u1', ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('permite acesso ao próprio tenant', async () => {
    const { guard } = makeGuard({ ownerId: 'clinica-A', doctorId: 'medico-1' });
    const ctx = makeCtx({
      params: { id: 'sc-de-A' },
      user: { userId: 'u1', ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('404 quando a SC não existe', async () => {
    const { guard } = makeGuard(null);
    const ctx = makeCtx({
      params: { id: 'inexistente' },
      user: { userId: 'u1', ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolve o id a partir de body.surgeryRequestId', async () => {
    const { guard, repo } = makeGuard({
      ownerId: 'clinica-A',
      doctorId: 'medico-1',
    });
    const ctx = makeCtx({
      body: { surgeryRequestId: 'sc-1', id: 'item-99' },
      user: { userId: 'u1', ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.findOneSimple).toHaveBeenCalledWith({ id: 'sc-1' });
  });

  it('libera rotas sem id de recurso (listagens)', async () => {
    const { guard, repo } = makeGuard(null);
    const ctx = makeCtx({ user: { userId: 'u1', ownerId: 'clinica-A' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.findOneSimple).not.toHaveBeenCalled();
  });

  it('respeita @SkipSurgeryOwner()', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const { guard, repo } = makeGuard({
      ownerId: 'clinica-B',
      doctorId: 'medico-1',
    });
    const ctx = makeCtx({
      params: { id: 'template-1' },
      user: { userId: 'u1', ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.findOneSimple).not.toHaveBeenCalled();
  });

  // Recorte por médico (user_doctor_access) — dentro da mesma clínica, o
  // usuário só alcança as SCs dos médicos aos quais está vinculado.
  describe('recorte por médico', () => {
    const scDoMedicoB = {
      id: 'sc-1',
      ownerId: 'clinica-a',
      doctorId: 'medico-b',
    };

    it('bloqueia colaborador da mesma clinica sem vinculo com o medico', async () => {
      const { guard, accessControl } = makeGuard(scDoMedicoB, false);

      await expect(
        guard.canActivate(
          makeCtx({
            params: { id: 'sc-1' },
            user: { userId: 'u1', ownerId: 'clinica-a' },
          }),
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(accessControl.canAccessDoctor).toHaveBeenCalledWith(
        'u1',
        'medico-b',
      );
    });

    it('permite quem tem vinculo com o medico da SC', async () => {
      const { guard } = makeGuard(scDoMedicoB, true);

      await expect(
        guard.canActivate(
          makeCtx({
            params: { id: 'sc-1' },
            user: { userId: 'u1', ownerId: 'clinica-a' },
          }),
        ),
      ).resolves.toBe(true);
    });
  });
});
