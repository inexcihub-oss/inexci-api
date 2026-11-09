import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ADMIN_REFRESH_COOKIE,
  AdminAuthController,
} from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthController', () => {
  const service = {
    login: jest.fn(),
    setupMfa: jest.fn(),
    enableMfa: jest.fn(),
    loginWithMfa: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
    me: jest.fn(),
    regenerateRecoveryCodes: jest.fn(),
    acceptInvite: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new AdminAuthController(
    service as unknown as AdminAuthService,
  );
  const sessao = {
    accessToken: 'access',
    refreshToken: 'refresh',
    admin: { id: 'a1', name: 'Ana', email: 'a@x.com', mfaEnabled: true },
  };

  function resposta() {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response & {
      cookie: jest.Mock;
      clearCookie: jest.Mock;
    };
  }

  const ambiente = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ambiente };
    delete process.env.AUTH_REFRESH_COOKIE_DOMAIN;
    delete process.env.AUTH_REFRESH_COOKIE_SAMESITE;
    delete process.env.AUTH_REFRESH_COOKIE_SECURE;
  });
  afterAll(() => {
    process.env = ambiente;
  });

  it('login/mfa devolve só token e admin e grava o cookie próprio do painel', async () => {
    service.loginWithMfa.mockResolvedValue(sessao);
    const res = resposta();

    const body = await controller.loginMfa(
      { mfaToken: 't', code: '123456' },
      res,
    );

    expect(body).toEqual({ accessToken: 'access', admin: sessao.admin });
    expect(res.cookie).toHaveBeenCalledWith(
      ADMIN_REFRESH_COOKIE,
      'refresh',
      expect.objectContaining({
        httpOnly: true,
        path: '/admin/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      }),
    );
    expect(ADMIN_REFRESH_COOKIE).toBe('inexci_admin_refresh');
  });

  it('mfa/enable devolve também os códigos de recuperação', async () => {
    service.enableMfa.mockResolvedValue({ ...sessao, recoveryCodes: ['X'] });
    const res = resposta();

    const body = await controller.mfaEnable(
      { setupToken: 's', code: '123456' },
      res,
    );

    expect(body).toEqual({
      accessToken: 'access',
      admin: sessao.admin,
      recoveryCodes: ['X'],
    });
    expect(res.cookie).toHaveBeenCalledTimes(1);
  });

  it('o cookie segue as flags do cookie da clínica (SameSite, Secure, Domain)', async () => {
    process.env.AUTH_REFRESH_COOKIE_SAMESITE = 'none';
    process.env.AUTH_REFRESH_COOKIE_DOMAIN = '.inexci.com.br';
    service.loginWithMfa.mockResolvedValue(sessao);
    const res = resposta();

    await controller.loginMfa({ mfaToken: 't', code: '123456' }, res);

    expect(res.cookie.mock.calls[0][2]).toMatchObject({
      sameSite: 'none',
      secure: true,
      domain: '.inexci.com.br',
      path: '/admin/auth',
    });
  });

  it('refresh lê só o cookie do painel', async () => {
    service.refresh.mockResolvedValue(sessao);
    const res = resposta();
    const req = {
      cookies: { refresh_token: 'da-clinica', [ADMIN_REFRESH_COOKIE]: 'meu' },
    } as unknown as Request;

    const body = await controller.refresh(req, res);

    expect(service.refresh).toHaveBeenCalledWith('meu');
    expect(body).toEqual({ accessToken: 'access', admin: sessao.admin });
  });

  it('refresh sem o cookie do painel responde 400, mesmo com o da clínica', async () => {
    const req = {
      cookies: { refresh_token: 'da-clinica' },
    } as unknown as Request;

    await expect(controller.refresh(req, resposta())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.refresh).not.toHaveBeenCalled();
  });

  it('refresh recusado limpa o cookie', async () => {
    service.refresh.mockRejectedValue(new UnauthorizedException());
    const res = resposta();
    const req = {
      cookies: { [ADMIN_REFRESH_COOKIE]: 'velho' },
    } as unknown as Request;

    await expect(controller.refresh(req, res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      ADMIN_REFRESH_COOKIE,
      expect.objectContaining({ path: '/admin/auth' }),
    );
  });

  it('logout repassa bearer e cookie e sempre limpa o cookie', async () => {
    const res = resposta();
    const req = {
      headers: { authorization: 'Bearer abc' },
      cookies: { [ADMIN_REFRESH_COOKIE]: 'r' },
    } as unknown as Request;

    await controller.logout(req, res);

    expect(service.logout).toHaveBeenCalledWith({
      accessToken: 'abc',
      refreshToken: 'r',
    });
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('accept-invite repassa e-mail, token e senha', async () => {
    await controller.acceptInvite({
      email: 'a@x.com',
      token: 'tok',
      password: 'Teste123@',
    });

    expect(service.acceptInvite).toHaveBeenCalledWith(
      'a@x.com',
      'tok',
      'Teste123@',
    );
  });
});
