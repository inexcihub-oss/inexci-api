import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Response, Request } from 'express';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    login: jest.fn(),
    register: jest.fn(),
    refreshAccessToken: jest.fn(),
    revokeRefreshTokens: jest.fn(),
    me: jest.fn(),
    changePasswordAuthenticated: jest.fn(),
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
      providers: [{ provide: AuthService, useValue: mockAuthService }],
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

      // Cookie should be set with httpOnly
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'rt-123',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/auth',
        }),
      );

      // Response body should NOT contain refresh_token
      expect(result).not.toHaveProperty('refresh_token');
      expect(result).toHaveProperty('access_token', 'jwt-token');
      expect(result).toHaveProperty('user');
    });
  });

  describe('register', () => {
    it('should NOT start a session and exclude refresh_token/access_token from body', async () => {
      // O fluxo de registro exige confirmação por e-mail antes do login,
      // então o controller descarta qualquer token retornado pelo service.
      const registerResult = {
        user: { id: 'user-2', name: 'New User' },
        access_token: 'jwt-token-2',
        refresh_token: 'rt-456',
      };
      mockAuthService.register.mockResolvedValue(registerResult);

      const result = await controller.register({
        name: 'New User',
        email: 'new@test.com',
        password: '123456',
      } as any);

      expect(result).not.toHaveProperty('refresh_token');
      expect(result).not.toHaveProperty('access_token');
      expect(result).toHaveProperty('user');
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
      const result = await controller.refresh(req, undefined, res);

      // Should have called service with token from cookie
      expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith('old-rt');

      // Should set new cookie
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'new-rt',
        expect.objectContaining({ httpOnly: true }),
      );

      // Should not include refresh_token in body
      expect(result).not.toHaveProperty('refresh_token');
      expect(result).toHaveProperty('access_token', 'new-jwt');
    });

    it('should fallback to body refresh_token when cookie is absent', async () => {
      const refreshResult = {
        access_token: 'new-jwt',
        refresh_token: 'new-rt',
      };
      mockAuthService.refreshAccessToken.mockResolvedValue(refreshResult);

      const req = mockRequest({}) as Request;
      const res = mockResponse() as Response;
      await controller.refresh(req, 'body-rt', res);

      expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith(
        'body-rt',
      );
    });
  });

  describe('logout', () => {
    it('should revoke tokens and clear cookie', async () => {
      mockAuthService.revokeRefreshTokens.mockResolvedValue(undefined);

      const res = mockResponse() as Response;
      const result = await controller.logout(
        { userId: 'user-1', role: 'admin' } as any,
        res,
      );

      expect(mockAuthService.revokeRefreshTokens).toHaveBeenCalledWith(
        'user-1',
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({ httpOnly: true, path: '/auth' }),
      );
      expect(result).toEqual({ message: 'Logout realizado com sucesso' });
    });
  });

  describe('changePasswordAuthenticated', () => {
    it('should revoke tokens and clear cookie after password change', async () => {
      mockAuthService.changePasswordAuthenticated.mockResolvedValue({
        message: 'Senha alterada com sucesso',
      });
      mockAuthService.revokeRefreshTokens.mockResolvedValue(undefined);

      const res = mockResponse() as Response;
      const result = await controller.changePasswordAuthenticated(
        { currentPassword: 'old', newPassword: 'new123456' },
        { userId: 'user-1', role: 'admin' } as any,
        res,
      );

      expect(mockAuthService.revokeRefreshTokens).toHaveBeenCalledWith(
        'user-1',
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toEqual({ message: 'Senha alterada com sucesso' });
    });
  });
});
