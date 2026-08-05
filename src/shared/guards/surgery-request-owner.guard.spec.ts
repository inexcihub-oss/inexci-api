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

// O id da SC é `uuid` no banco: qualquer literal fora desse formato faz o
// Postgres abortar a query, então os cenários precisam de UUIDs de verdade.
const SC_A = '11111111-1111-4111-8111-111111111111';
const SC_B = '22222222-2222-4222-8222-222222222222';
const SC_INEXISTENTE = '33333333-3333-4333-8333-333333333333';

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
      params: { id: SC_B },
      user: { userId: 'u1', ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('permite acesso ao próprio tenant', async () => {
    const { guard } = makeGuard({ ownerId: 'clinica-A', doctorId: 'medico-1' });
    const ctx = makeCtx({
      params: { id: SC_A },
      user: { userId: 'u1', ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('404 quando a SC não existe', async () => {
    const { guard } = makeGuard(null);
    const ctx = makeCtx({
      params: { id: SC_INEXISTENTE },
      user: { userId: 'u1', ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // O id chega do cliente (params/query/body) e vai direto para um WHERE sobre
  // uma coluna `uuid`. Sem esta checagem, `id=1` derruba a query no Postgres
  // ("invalid input syntax for type uuid") e o usuário recebe 500 em vez de 404.
  it.each([
    ['string sem formato de uuid', { params: { id: 'invalid' } }],
    ['id numérico no corpo', { body: { id: 999999 } }],
    ['uuid truncado na query', { query: { surgeryRequestId: '1111-2222' } }],
  ])(
    '404 sem consultar o banco quando o id não é uuid (%s)',
    async (_, req) => {
      const { guard, repo } = makeGuard(null);
      const ctx = makeCtx({
        ...req,
        user: { userId: 'u1', ownerId: 'clinica-A' },
      });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.findOneSimple).not.toHaveBeenCalled();
    },
  );

  it('resolve o id a partir de body.surgeryRequestId', async () => {
    const { guard, repo } = makeGuard({
      ownerId: 'clinica-A',
      doctorId: 'medico-1',
    });
    const ctx = makeCtx({
      body: { surgeryRequestId: SC_A, id: 'item-99' },
      user: { userId: 'u1', ownerId: 'clinica-A' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.findOneSimple).toHaveBeenCalledWith({ id: SC_A });
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
      id: SC_A,
      ownerId: 'clinica-a',
      doctorId: 'medico-b',
    };

    it('bloqueia colaborador da mesma clinica sem vinculo com o medico', async () => {
      const { guard, accessControl } = makeGuard(scDoMedicoB, false);

      await expect(
        guard.canActivate(
          makeCtx({
            params: { id: SC_A },
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
            params: { id: SC_A },
            user: { userId: 'u1', ownerId: 'clinica-a' },
          }),
        ),
      ).resolves.toBe(true);
    });
  });
});
