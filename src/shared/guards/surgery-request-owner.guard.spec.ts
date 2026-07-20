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

  function makeGuard(sr: { ownerId: string } | null) {
    const repo = {
      findOneSimple: jest.fn().mockResolvedValue(sr),
    };
    return {
      guard: new SurgeryRequestOwnerGuard(reflector, repo as never),
      repo,
    };
  }

  beforeEach(() => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
  });

  it('bloqueia acesso cross-tenant (403)', async () => {
    const { guard } = makeGuard({ ownerId: 'clinica-B' });
    const ctx = makeCtx({
      params: { id: 'sc-de-B' },
      user: { ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('permite acesso ao próprio tenant', async () => {
    const { guard } = makeGuard({ ownerId: 'clinica-A' });
    const ctx = makeCtx({
      params: { id: 'sc-de-A' },
      user: { ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('404 quando a SC não existe', async () => {
    const { guard } = makeGuard(null);
    const ctx = makeCtx({
      params: { id: 'inexistente' },
      user: { ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolve o id a partir de body.surgeryRequestId', async () => {
    const { guard, repo } = makeGuard({ ownerId: 'clinica-A' });
    const ctx = makeCtx({
      body: { surgeryRequestId: 'sc-1', id: 'item-99' },
      user: { ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.findOneSimple).toHaveBeenCalledWith({ id: 'sc-1' });
  });

  it('libera rotas sem id de recurso (listagens)', async () => {
    const { guard, repo } = makeGuard(null);
    const ctx = makeCtx({ user: { ownerId: 'clinica-A' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.findOneSimple).not.toHaveBeenCalled();
  });

  it('respeita @SkipSurgeryOwner()', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const { guard, repo } = makeGuard({ ownerId: 'clinica-B' });
    const ctx = makeCtx({
      params: { id: 'template-1' },
      user: { ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.findOneSimple).not.toHaveBeenCalled();
  });
});
