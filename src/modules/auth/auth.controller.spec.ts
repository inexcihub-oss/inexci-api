import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Response, Request } from 'express';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MfaService } from './mfa/mfa.service';
import { JsonOnlyGuard } from './json-only.guard';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    login: jest.fn(),
    register: jest.fn(),
    refreshAccessToken: jest.fn(),
    revokeRefreshTokens: jest.fn(),
    logout: jest.fn(),
    me: jest.fn(),
    changePasswordAuthenticated: jest.fn(),
    loginWithMfa: jest.fn(),
    issueSessionTokens: jest.fn(),
  };

  const mockMfaService = {
    setup: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    regenerateRecoveryCodes: jest.fn(),
  };

  const mockResponse = (): Partial<Response> => {
    const res: Partial<Response> = {
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
    };
    return res;
  };

  const mockRequest = (
    cookies: Record<string, string> = {},
  ): Partial<Request> => ({
    cookies,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: MfaService, useValue: mockMfaService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => 'http://localhost:3001') },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should set refresh_token as httpOnly cookie and exclude it from response body', async () => {
      const loginResult = {
        user: { id: 'user-1', name: 'Test' },
        access_token: 'jwt-token',
        refresh_token: 'rt-123',
      };
      mockAuthService.login.mockResolvedValue(loginResult);

      const res = mockResponse() as Response;
      const result = await controller.login(
        { email: 'test@test.com', password: '123456' },
        res,
      );

      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'rt-123',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/auth',
        }),
      );

      expect(result).not.toHaveProperty('refresh_token');
      expect(result).toHaveProperty('access_token', 'jwt-token');
      expect(result).toHaveProperty('user');
    });
  });

  describe('MFA', () => {
    const usuario = { userId: 'user-1' } as never;

    it('login com MFA ativo devolve o desafio sem cookie nem access token', async () => {
      mockAuthService.login.mockResolvedValue({
        mfaRequired: true,
        mfaToken: 'mfa-token',
      });
      const res = mockResponse() as Response;

      const result = await controller.login(
        { email: 'a@b.com', password: 'x' },
        res,
      );

      expect(result).toEqual({ mfaRequired: true, mfaToken: 'mfa-token' });
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('login/mfa grava o refresh no cookie e não o devolve no corpo', async () => {
      mockAuthService.loginWithMfa.mockResolvedValue({
        user: { id: 'user-1' },
        access_token: 'jwt',
        refresh_token: 'rt-mfa',
      });
      const res = mockResponse() as Response;

      const result = await controller.loginMfa(
        { mfaToken: 't', code: '123456' },
        res,
      );

      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'rt-mfa',
        expect.objectContaining({ httpOnly: true, path: '/auth' }),
      );
      expect(result).not.toHaveProperty('refresh_token');
      expect(result).toHaveProperty('access_token', 'jwt');
    });

    it('login/mfa com código errado não grava cookie', async () => {
      mockAuthService.loginWithMfa.mockRejectedValue(
        new BadRequestException('Código de verificação inválido.'),
      );
      const res = mockResponse() as Response;

      await expect(
        controller.loginMfa({ mfaToken: 't', code: '000000' }, res),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('setup, enable e recovery-codes delegam ao MfaService com o usuário da sessão', async () => {
      mockMfaService.setup.mockResolvedValue({ secret: 'S' });
      mockMfaService.enable.mockResolvedValue({ recoveryCodes: ['A'] });
      mockMfaService.regenerateRecoveryCodes.mockResolvedValue({
        recoveryCodes: ['B'],
      });

      await expect(controller.mfaSetup(usuario)).resolves.toEqual({
        secret: 'S',
      });
      await expect(
        controller.mfaEnable({ code: '123456' }, usuario),
      ).resolves.toEqual({ recoveryCodes: ['A'] });
      await expect(
        controller.mfaRecoveryCodes({ code: '123456' }, usuario),
      ).resolves.toEqual({ recoveryCodes: ['B'] });
      expect(mockMfaService.enable).toHaveBeenCalledWith('user-1', '123456');
    });

    it('disable revoga as sessões e reabre só a sessão atual (novo cookie + access token)', async () => {
      mockMfaService.disable.mockResolvedValue({ message: 'ok' });
      mockAuthService.issueSessionTokens.mockResolvedValue({
        access_token: 'novo-jwt',
        refresh_token: 'novo-rt',
      });
      const res = mockResponse() as Response;

      const result = await controller.mfaDisable(
        { password: 'x', code: '123456' },
        usuario,
        res,
      );

      expect(mockMfaService.disable).toHaveBeenCalledWith(
        'user-1',
        'x',
        '123456',
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'novo-rt',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toEqual({ message: 'ok', access_token: 'novo-jwt' });
    });

    it('disable que falha não reabre sessão', async () => {
      mockMfaService.disable.mockRejectedValue(
        new BadRequestException('Senha atual incorreta'),
      );
      const res = mockResponse() as Response;

      await expect(
        controller.mfaDisable({ password: 'x', code: '1' }, usuario, res),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockAuthService.issueSessionTokens).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('as rotas de MFA herdam o JsonOnlyGuard da classe', () => {
      const guards = Reflect.getMetadata('__guards__', AuthController) as
        | unknown[]
        | undefined;
      expect(guards).toContain(JsonOnlyGuard);
    });
  });

  describe('register', () => {
    it('should NOT start a session and exclude refresh_token/access_token from body', async () => {
      const registerResult = {
        user: { id: 'user-2', name: 'New User' },
      };
      mockAuthService.register.mockResolvedValue(registerResult);

      const result = await controller.register(
        {
          name: 'New User',
          email: 'new@test.com',
          password: '123456',
        } as any,
        { ip: '203.0.113.7' } as Request,
      );

      expect(result).not.toHaveProperty('refresh_token');
      expect(result).not.toHaveProperty('access_token');
      expect(result).toHaveProperty('user');
    });

    it('repassa o IP do cliente ao service para a validação do captcha', async () => {
      mockAuthService.register.mockResolvedValue({ user: { id: 'u' } });
      const body = {
        name: 'New User',
        email: 'new@test.com',
        password: '123456',
        captchaToken: 'tok',
      } as any;

      await controller.register(body, { ip: '203.0.113.7' } as Request);

      expect(mockAuthService.register).toHaveBeenCalledWith(
        body,
        '203.0.113.7',
      );
    });
  });

  describe('refresh', () => {
    it('should read refresh_token from cookie and set new one', async () => {
      const refreshResult = {
        access_token: 'new-jwt',
        refresh_token: 'new-rt',
      };
      mockAuthService.refreshAccessToken.mockResolvedValue(refreshResult);

      const req = mockRequest({ refresh_token: 'old-rt' }) as Request;
      const res = mockResponse() as Response;
      const result = await controller.refresh(req, res);

      expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith('old-rt');

      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'new-rt',
        expect.objectContaining({ httpOnly: true }),
      );

      expect(result).not.toHaveProperty('refresh_token');
      expect(result).toHaveProperty('access_token', 'new-jwt');
    });

    it('should ignore body refresh_token and require the httpOnly cookie (V5)', async () => {
      const req = mockRequest({}) as Request;
      (req as unknown as { body: unknown }).body = { refresh_token: 'body-rt' };
      const res = mockResponse() as Response;

      await expect(controller.refresh(req, res)).rejects.toThrow(
        'Refresh token ausente',
      );
      expect(mockAuthService.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('should clear refresh cookie when token is invalid', async () => {
      mockAuthService.refreshAccessToken.mockRejectedValue(
        new BadRequestException('Refresh token inválido'),
      );

      const req = mockRequest({ refresh_token: 'invalid-rt' }) as Request;
      const res = mockResponse() as Response;

      await expect(controller.refresh(req, res)).rejects.toThrow(
        'Refresh token inválido',
      );

      expect(res.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({ httpOnly: true, path: '/auth' }),
      );
    });

    it('não apaga o cookie quando o token já foi renovado em outra aba (409)', async () => {
      mockAuthService.refreshAccessToken.mockRejectedValue(
        new ConflictException('Sessão já renovada em outra aba.'),
      );

      const req = mockRequest({ refresh_token: 'rt-da-corrida' }) as Request;
      const res = mockResponse() as Response;

      await expect(controller.refresh(req, res)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(res.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should revoke tokens and clear cookie', async () => {
      mockAuthService.logout.mockResolvedValue(undefined);

      const res = mockResponse() as Response;
      const result = await controller.logout(
        { userId: 'user-1', role: 'admin' } as any,
        res,
      );

      expect(mockAuthService.logout).toHaveBeenCalledWith('user-1');
      expect(res.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({ httpOnly: true, path: '/auth' }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({ path: '/' }),
      );
      expect(result).toEqual({ message: 'Logout realizado com sucesso' });
    });
  });

  describe('changePasswordAuthenticated', () => {
    it('should clear cookie after password change (a revogação fica no service)', async () => {
      mockAuthService.changePasswordAuthenticated.mockResolvedValue({
        message: 'Senha alterada com sucesso',
      });

      const res = mockResponse() as Response;
      const result = await controller.changePasswordAuthenticated(
        { currentPassword: 'old', newPassword: 'new123456' },
        { userId: 'user-1', role: 'admin' } as any,
        res,
      );

      expect(mockAuthService.changePasswordAuthenticated).toHaveBeenCalledWith(
        { currentPassword: 'old', newPassword: 'new123456' },
        'user-1',
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toEqual({ message: 'Senha alterada com sucesso' });
    });
  });

  describe('cookie de refresh em produção', () => {
    const envOriginal = { ...process.env };

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      delete process.env.AUTH_REFRESH_COOKIE_SAMESITE;
      delete process.env.AUTH_REFRESH_COOKIE_PATH;
      delete process.env.AUTH_REFRESH_COOKIE_SECURE;
      delete process.env.AUTH_REFRESH_COOKIE_DOMAIN;
    });

    afterEach(() => {
      process.env = { ...envOriginal };
    });

    it('usa SameSite=Lax, Secure e Path=/auth por padrão', async () => {
      mockAuthService.login.mockResolvedValue({
        user: { id: 'u' },
        access_token: 'jwt',
        refresh_token: 'rt',
      });
      const res = mockResponse() as Response;

      await controller.login({ email: 'a@b.com', password: 'x' }, res);

      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'rt',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/auth',
        }),
      );
    });

    it('apaga o cookie legado de Path=/ ao emitir o novo, para não haver dois com o mesmo nome', async () => {
      mockAuthService.refreshAccessToken.mockResolvedValue({
        access_token: 'jwt',
        refresh_token: 'rt-novo',
      });
      const res = mockResponse() as Response;

      await controller.refresh(
        mockRequest({ refresh_token: 'rt-antigo' }) as Request,
        res,
      );

      const caminhosApagados = (res.clearCookie as jest.Mock).mock.calls.map(
        ([, opcoes]) => (opcoes as { path: string }).path,
      );
      expect(caminhosApagados).toEqual(
        expect.arrayContaining(['/', '/auth/refresh']),
      );
      expect(caminhosApagados).not.toContain('/auth');
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'rt-novo',
        expect.objectContaining({ path: '/auth' }),
      );
    });

    it('respeita os overrides AUTH_REFRESH_COOKIE_*', async () => {
      process.env.AUTH_REFRESH_COOKIE_SAMESITE = 'none';
      process.env.AUTH_REFRESH_COOKIE_PATH = '/';
      mockAuthService.login.mockResolvedValue({
        user: { id: 'u' },
        access_token: 'jwt',
        refresh_token: 'rt',
      });
      const res = mockResponse() as Response;

      await controller.login({ email: 'a@b.com', password: 'x' }, res);

      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'rt',
        expect.objectContaining({ sameSite: 'none', secure: true, path: '/' }),
      );
      const caminhosApagados = (res.clearCookie as jest.Mock).mock.calls.map(
        ([, opcoes]) => (opcoes as { path: string }).path,
      );
      expect(caminhosApagados).not.toContain('/');
    });
  });
});
