import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PlatformAdminStatus } from 'src/database/entities/platform-admin.entity';
import { AdminSessionGuard, RequestComAdmin } from './admin-session.guard';
import { AdminTokenService } from './admin-token.service';

const SECRET = 'segredo-de-teste';

describe('AdminSessionGuard', () => {
  const tokens = new AdminTokenService({
    get: jest.fn((chave: string, padrao?: string) =>
      chave === 'JWT_SECRET' ? SECRET : padrao,
    ),
  } as unknown as ConfigService);
  const admins = {
    findSession: jest.fn(),
    touchLastSeen: jest.fn().mockResolvedValue(undefined),
  };
  const guard = new AdminSessionGuard(tokens, admins as never);

  const ativo = {
    id: 'admin-1',
    name: 'Ana',
    email: 'ana@inexci.com',
    status: PlatformAdminStatus.ACTIVE,
    tokenVersion: 4,
    mfaEnabledAt: new Date(),
  };

  function contexto(authorization?: string): {
    ctx: ExecutionContext;
    req: RequestComAdmin;
  } {
    const req = { headers: { authorization } } as unknown as RequestComAdmin;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { ctx, req };
  }

  beforeEach(() => jest.clearAllMocks());

  it('aceita a sessão do painel, expõe o admin e atualiza o último acesso', async () => {
    admins.findSession.mockResolvedValue(ativo);
    const { ctx, req } = contexto(`Bearer ${tokens.signAccess(ativo)}`);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(req.admin).toEqual({
      adminId: 'admin-1',
      name: 'Ana',
      email: 'ana@inexci.com',
    });
    expect(admins.touchLastSeen).toHaveBeenCalledWith('admin-1');
  });

  it('sem bearer responde 401', async () => {
    await expect(guard.canActivate(contexto().ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token da clínica responde 401 sem consultar o banco', async () => {
    const clinica = new JwtService({ secret: SECRET }).sign(
      { userId: 'admin-1', tv: 4 },
      { issuer: 'inexci-api', audience: 'inexci-app' },
    );

    await expect(
      guard.canActivate(contexto(`Bearer ${clinica}`).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(admins.findSession).not.toHaveBeenCalled();
  });

  it.each([
    ['inativo', { ...ativo, status: PlatformAdminStatus.INACTIVE }],
    ['pendente', { ...ativo, status: PlatformAdminStatus.PENDING }],
    ['sem MFA', { ...ativo, mfaEnabledAt: null }],
    ['com token_version novo', { ...ativo, tokenVersion: 5 }],
    ['inexistente', null],
  ])('admin %s responde 401', async (_caso, linha) => {
    admins.findSession.mockResolvedValue(linha);
    const { ctx } = contexto(`Bearer ${tokens.signAccess(ativo)}`);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(admins.touchLastSeen).not.toHaveBeenCalled();
  });

  it('falha ao gravar o último acesso não derruba a requisição', async () => {
    admins.findSession.mockResolvedValue(ativo);
    admins.touchLastSeen.mockRejectedValueOnce(new Error('db'));

    await expect(
      guard.canActivate(contexto(`Bearer ${tokens.signAccess(ativo)}`).ctx),
    ).resolves.toBe(true);
  });
});
