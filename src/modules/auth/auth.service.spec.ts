import { Test, TestingModule } from '@nestjs/testing';
import {
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthService } from './auth.service';
import { RefreshTokenStore } from './refresh-token.store';
import { UserRepository } from 'src/database/repositories/user.repository';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';
import { ConfigService } from '@nestjs/config';
import { ConsentService } from '../privacy/consent.service';
import { SubscriptionService } from '../billing/services/subscription.service';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { StorageService } from 'src/shared/storage/storage.service';

// Mock bcryptjs before it's imported by the service
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));
import * as bcryptjs from 'bcryptjs';

jest.mock('uuid', () => ({ v4: () => 'mock-uuid-1234' }));
jest.mock('src/shared/utils', () => ({
  generateValidationCode: () => '123456',
}));

describe('AuthService', () => {
  let service: AuthService;

  const mockUserRepository = {
    findOne: jest.fn(),
    findOneWithProfile: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const mockRecoveryCodeRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    updateByWhere: jest.fn(),
    deleteMany: jest.fn(),
  };

  const mockDoctorProfileRepository = {
    findByUserId: jest.fn(),
    create: jest.fn(),
  };

  const mockMailService = {
    sendRaw: jest.fn(),
    sendPasswordRecovery: jest.fn(),
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
  };

  const mockWhatsappService = {
    sendUserWelcome: jest.fn().mockResolvedValue(undefined),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
  };

  const mockSubscriptionService = {
    createTrialSubscription: jest.fn().mockResolvedValue({ id: 'sub-1' }),
  };

  const mockProcedureRepository = {
    create: jest.fn().mockResolvedValue({}),
  };

  const mockStorageService = {
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.url/avatar.png'),
  };

  const mockRefreshTokenStore = {
    issue: jest.fn().mockResolvedValue('new-refresh-token'),
    consume: jest.fn(),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockConsentService = {
    getStatus: jest.fn().mockResolvedValue({
      privacyPolicyAcceptedAt: new Date(),
      termsOfUseAcceptedAt: new Date(),
      aiConsentAcceptedAt: null,
      requiredConsentsAccepted: true,
      pendingRequired: [],
    }),
    acceptTerms: jest.fn().mockResolvedValue(undefined),
    grantAi: jest.fn().mockResolvedValue(undefined),
    revokeAi: jest.fn().mockResolvedValue(undefined),
    hasValidAiConsent: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserRepository, useValue: mockUserRepository },
        {
          provide: RecoveryCodeRepository,
          useValue: mockRecoveryCodeRepository,
        },
        {
          provide: DoctorProfileRepository,
          useValue: mockDoctorProfileRepository,
        },
        { provide: MailService, useValue: mockMailService },
        { provide: WhatsappService, useValue: mockWhatsappService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: RefreshTokenStore, useValue: mockRefreshTokenStore },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ConsentService, useValue: mockConsentService },
        { provide: SubscriptionService, useValue: mockSubscriptionService },
        { provide: ProcedureRepository, useValue: mockProcedureRepository },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // ─── validateUser ───────────────────────────────────────────────

  describe('validateUser', () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      password: 'hashed-password',
      status: UserStatus.ACTIVE,
      emailVerified: true,
    };

    it('should return user when credentials are correct', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser(
        'test@example.com',
        'correct-password',
      );
      expect(result).toEqual(mockUser);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith(
        { email: 'test@example.com', status: UserStatus.ACTIVE },
        true,
      );
    });

    it('should throw HttpException when password is wrong', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      (bcryptjs.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.validateUser('test@example.com', 'wrong-password'),
      ).rejects.toThrow(HttpException);

      (bcryptjs.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.validateUser('test@example.com', 'wrong-password'),
      ).rejects.toMatchObject({
        response: 'E-mail ou senha inválidos',
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('should throw HttpException when user is not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.validateUser('notfound@example.com', 'any-password'),
      ).rejects.toThrow(HttpException);
    });

    it('should throw UnauthorizedException (401) when user has no password', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        ...mockUser,
        password: null,
      });

      await expect(
        service.validateUser('test@example.com', 'any-password'),
      ).rejects.toThrow(UnauthorizedException);

      mockUserRepository.findOne.mockResolvedValue({
        ...mockUser,
        password: undefined,
      });

      await expect(
        service.validateUser('test@example.com', 'any-password'),
      ).rejects.toMatchObject({
        message:
          'Conta sem senha definida. Acesse pelo link de primeiro acesso.',
        status: 401,
      });
    });
  });

  // ─── changePasswordAuthenticated ────────────────────────────────

  describe('changePasswordAuthenticated', () => {
    it('should throw UnauthorizedException when user has no password defined', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        password: null,
      });

      await expect(
        service.changePasswordAuthenticated(
          { currentPassword: 'any', newPassword: 'new123' },
          'user-1',
        ),
      ).rejects.toThrow(UnauthorizedException);

      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        password: null,
      });

      await expect(
        service.changePasswordAuthenticated(
          { currentPassword: 'any', newPassword: 'new123' },
          'user-1',
        ),
      ).rejects.toMatchObject({
        message:
          'Conta sem senha definida. Acesse pelo link de primeiro acesso.',
        status: 401,
      });
    });
  });

  // ─── register ───────────────────────────────────────────────────

  describe('register', () => {
    const mockPlan = { id: 'plan-1', name: 'Básico', isActive: true };

    it('should throw when email is already registered (active)', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        email: 'existing@example.com',
        status: UserStatus.ACTIVE,
      });

      await expect(
        service.register({
          name: 'Test',
          email: 'existing@example.com',
          password: '123456',
        } as any),
      ).rejects.toThrow(
        'Este e-mail já está cadastrado. Faça login ou recupere sua senha.',
      );
    });

    it('should throw when email belongs to a pending invite', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        email: 'pending@example.com',
        status: UserStatus.PENDING,
      });

      await expect(
        service.register({
          name: 'Test',
          email: 'pending@example.com',
          password: '123456',
        } as any),
      ).rejects.toThrow(
        'Este e-mail está associado a um convite pendente. Verifique sua caixa de entrada para ativar sua conta.',
      );
    });

    it('should create user with doctor profile and return token', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-password');

      const createdUser = {
        id: 'mock-uuid-1234',
        name: 'Dr. Test',
        email: 'doctor@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: null,
        cpf: null,
        ownerId: 'mock-uuid-1234',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      mockUserRepository.create.mockResolvedValue(createdUser);

      const createdProfile = {
        id: 'profile-1',
        crm: '12345',
        crmState: 'SP',
        specialty: 'Cardiology',
        signatureUrl: null,
        clinicName: null,
      };
      mockDoctorProfileRepository.create.mockResolvedValue(createdProfile);

      const result = await service.register({
        name: 'Dr. Test',
        email: 'doctor@example.com',
        password: '123456',
        phone: '11999998888',
        isDoctor: true,
        crm: '12345',
        crmState: 'SP',
        specialty: 'Cardiology',
      } as any);

      expect(result.user.isDoctor).toBe(true);
      expect(result.user.doctorProfile).toEqual({
        id: 'profile-1',
        crm: '12345',
        crmState: 'SP',
        specialty: 'Cardiology',
        signatureUrl: null,
        clinicName: null,
      });
      // O cadastro não inicia sessão: nenhum token é emitido e nenhum refresh
      // token órfão é persistido (o usuário deve confirmar o e-mail antes de logar).
      expect((result as Record<string, unknown>).access_token).toBeUndefined();
      expect((result as Record<string, unknown>).refresh_token).toBeUndefined();
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
      expect(mockDoctorProfileRepository.create).toHaveBeenCalled();
    });

    it('should create user without doctor profile when isDoctor is false', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-password');

      const createdUser = {
        id: 'mock-uuid-1234',
        name: 'Assistant',
        email: 'assistant@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: null,
        cpf: null,
        ownerId: 'mock-uuid-1234',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      mockUserRepository.create.mockResolvedValue(createdUser);

      const result = await service.register({
        name: 'Assistant',
        email: 'assistant@example.com',
        password: '123456',
        phone: '11999998888',
        isDoctor: false,
      } as any);

      expect(result.user.isDoctor).toBe(false);
      expect(result.user.doctorProfile).toBeNull();
      expect(mockDoctorProfileRepository.create).not.toHaveBeenCalled();
      expect((result as Record<string, unknown>).access_token).toBeUndefined();
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
    });
  });

  // ─── login ──────────────────────────────────────────────────────

  describe('login', () => {
    it('should return user data and access_token', async () => {
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        password: 'hashed-password',
        role: UserRole.ADMIN,
        name: 'Test User',
        phone: '123',
        cpf: '000',
        status: UserStatus.ACTIVE,
        emailVerified: true,
        ownerId: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      // validateUser calls findOne with status + selectPassword
      mockUserRepository.findOne.mockImplementation(
        (where, selectPassword?) => {
          if (selectPassword) return Promise.resolve(mockUser); // validateUser call
          return Promise.resolve({ ...mockUser, ownerId: 'user-1' }); // fullUser call
        },
      );

      mockDoctorProfileRepository.findByUserId.mockResolvedValue(null);

      const result = await service.login({
        email: 'test@example.com',
        password: '123456',
      });

      expect(result!.user.id).toBe('user-1');
      expect(result!.user.email).toBe('test@example.com');
      expect(result!.access_token).toBe('mock-jwt-token');
      expect(result!.user.isDoctor).toBe(false);
    });
  });

  // ─── refreshAccessToken ─────────────────────────────────────────

  describe('refreshAccessToken', () => {
    it('rotaciona o token para um usuário ativo e verificado', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({
        status: 'valid',
        userId: 'user-1',
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        emailVerified: true,
      });

      const result = await service.refreshAccessToken('rt-token');

      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.refresh_token).toBe('new-refresh-token');
      // O consume revoga o token usado atomicamente; um novo é emitido.
      expect(mockRefreshTokenStore.consume).toHaveBeenCalledWith('rt-token');
      expect(mockRefreshTokenStore.issue).toHaveBeenCalledWith('user-1');
    });

    it('rejeita e revoga a sessão quando o e-mail não está verificado', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({
        status: 'valid',
        userId: 'user-1',
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        emailVerified: false,
      });

      await expect(service.refreshAccessToken('rt-token')).rejects.toThrow(
        UnauthorizedException,
      );
      // Revoga todos os refresh tokens do usuário para encerrar a sessão.
      expect(mockRefreshTokenStore.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
      // Não emite novo token.
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
    });

    it('rejeita quando a conta não está ativa', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({
        status: 'valid',
        userId: 'user-1',
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.PENDING,
        emailVerified: true,
      });

      await expect(service.refreshAccessToken('rt-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
    });

    it('rejeita um refresh token inexistente', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({ status: 'not_found' });

      await expect(service.refreshAccessToken('nope')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('detecta reuso de token: revoga a família e força novo login (401)', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({
        status: 'reused',
        userId: 'user-1',
      });

      await expect(service.refreshAccessToken('replayed')).rejects.toThrow(
        UnauthorizedException,
      );
      // Revoga TODOS os refresh tokens do usuário (revogação de família).
      expect(mockRefreshTokenStore.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
      // Não emite novo token.
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
    });
  });

  // ─── sendRecoveryPasswordEmail ──────────────────────────────────

  const GENERIC_RECOVERY_MESSAGE =
    'Se o e-mail existir, enviaremos um código de recuperação.';

  describe('sendRecoveryPasswordEmail', () => {
    it('anti-enumeration: e-mail inexistente retorna mensagem genérica sem lançar nem enfileirar e-mail', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await service.sendRecoveryPasswordEmail(
        'unknown@example.com',
      );

      expect(result).toEqual({ message: GENERIC_RECOVERY_MESSAGE });
      expect(mockRecoveryCodeRepository.create).not.toHaveBeenCalled();
      expect(mockMailService.sendPasswordRecovery).not.toHaveBeenCalled();
    });

    it('should create a recovery code with 15min expiry and send email', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test',
      };
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockRecoveryCodeRepository.deleteMany.mockResolvedValue(undefined);
      mockRecoveryCodeRepository.create.mockResolvedValue({});

      const beforeCall = Date.now();
      const result =
        await service.sendRecoveryPasswordEmail('test@example.com');
      const afterCall = Date.now();

      expect(result).toEqual({ message: GENERIC_RECOVERY_MESSAGE });
      expect(mockRecoveryCodeRepository.deleteMany).toHaveBeenCalledWith({
        userId: 'user-1',
        used: false,
      });

      const createCall = mockRecoveryCodeRepository.create.mock.calls[0][0];
      expect(createCall.userId).toBe('user-1');
      expect(createCall.used).toBe(false);
      expect(createCall.code).toBe('123456');
      // Verify expiry is ~15 minutes from now
      const expiresAt = createCall.expiresAt.getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(
        beforeCall + 15 * 60 * 1000 - 100,
      );
      expect(expiresAt).toBeLessThanOrEqual(afterCall + 15 * 60 * 1000 + 100);

      expect(mockMailService.sendPasswordRecovery).toHaveBeenCalledWith(
        'test@example.com',
        expect.objectContaining({ validationCode: '123456' }),
      );
    });
  });

  // ─── validateRecoveryPasswordCode ───────────────────────────────

  describe('validateRecoveryPasswordCode', () => {
    it('should throw NotFoundException when code is invalid', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findOne.mockResolvedValue(null);

      await expect(
        service.validateRecoveryPasswordCode({
          code: 'bad-code',
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Código inválido');
    });

    it('escopa por usuário: e-mail inexistente → Código inválido', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.validateRecoveryPasswordCode({
          code: '123456',
          email: 'nobody@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockRecoveryCodeRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when code is expired', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findOne.mockResolvedValue({
        id: 'code-1',
        code: '123456',
        used: false,
        expiresAt: new Date(Date.now() - 60 * 1000), // expired 1 minute ago
      });

      await expect(
        service.validateRecoveryPasswordCode({
          code: '123456',
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Código expirado');
    });

    it('marca o código como usado e emite um reset token', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findOne.mockResolvedValue({
        id: 'code-1',
        code: '123456',
        used: false,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // expires in 10 min
      });
      mockRecoveryCodeRepository.updateByWhere.mockResolvedValue({});

      const result = await service.validateRecoveryPasswordCode({
        code: '123456',
        email: 'test@example.com',
      });

      // uuid mockado → 'mock-uuid-1234'
      expect(result).toEqual({
        message: 'Código validado com sucesso',
        resetToken: 'mock-uuid-1234',
      });
      expect(mockRecoveryCodeRepository.updateByWhere).toHaveBeenCalledWith(
        { id: 'code-1' },
        expect.objectContaining({
          used: true,
          resetToken: 'mock-uuid-1234',
          resetTokenExpiresAt: expect.any(Date),
        }),
      );
    });
  });

  // ─── changePassword ─────────────────────────────────────────────

  describe('changePassword', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.changePassword({
          email: 'nobody@example.com',
          resetToken: 'reset-tok',
          password: 'new',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejeita quando o reset token não bate (inválido)', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findOne.mockResolvedValue(null);

      await expect(
        service.changePassword({
          email: 'test@example.com',
          resetToken: 'wrong-token',
          password: 'new',
        } as any),
      ).rejects.toThrow(
        'Token de redefinição inválido. Reinicie a recuperação de senha.',
      );
    });

    it('rejeita quando o reset token está expirado', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findOne.mockResolvedValue({
        id: 'code-1',
        userId: 'user-1',
        used: true,
        resetToken: 'reset-tok',
        resetTokenExpiresAt: new Date(Date.now() - 60 * 1000), // expirado
      });

      await expect(
        service.changePassword({
          email: 'test@example.com',
          resetToken: 'reset-tok',
          password: 'new',
        } as any),
      ).rejects.toThrow(
        'Token de redefinição expirado. Reinicie a recuperação de senha.',
      );
    });

    it('should hash the new password, save it, and delete recovery codes', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findOne.mockResolvedValue({
        id: 'code-1',
        userId: 'user-1',
        used: true,
        resetToken: 'reset-tok',
        resetTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-new-password');
      mockUserRepository.update.mockResolvedValue({});
      mockRecoveryCodeRepository.deleteMany.mockResolvedValue(undefined);

      const result = await service.changePassword({
        email: 'test@example.com',
        resetToken: 'reset-tok',
        password: 'new-password-123',
      } as any);

      expect(result).toEqual({ message: 'Senha alterada com sucesso' });

      // Verify bcryptjs.hash was called with the plain password
      expect(bcryptjs.hash).toHaveBeenCalledWith('new-password-123', 10);

      // Verify the hashed password was stored
      const updateCall = mockUserRepository.update.mock.calls[0];
      expect(updateCall[0]).toBe('user-1');
      expect(updateCall[1].password).toBe('hashed-new-password');

      // Verify recovery codes were cleaned up
      expect(mockRecoveryCodeRepository.deleteMany).toHaveBeenCalledWith({
        userId: 'user-1',
      });
    });
  });

  // ─── verifyEmail ─────────────────────────────────────────────────
  // O token de verificação é armazenado inline em `user`
  // (colunas `emailVerificationToken` / `emailVerificationExpiresAt`),
  // logo o spec usa `mockUserRepository` em vez de um repositório dedicado.

  describe('verifyEmail', () => {
    it('should throw BadRequestException when token is empty', async () => {
      await expect(service.verifyEmail('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when token does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.verifyEmail('invalid-token')).rejects.toThrow(
        'Token de verificação inválido',
      );
    });

    it('should throw BadRequestException when token is expired', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        emailVerified: false,
        emailVerificationToken: 'expired-token',
        emailVerificationExpiresAt: new Date(Date.now() - 60_000),
      });
      await expect(service.verifyEmail('expired-token')).rejects.toThrow(
        'O link de confirmação expirou',
      );
    });

    it('should confirm email and return message + email on valid token', async () => {
      const now = Date.now();
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        emailVerified: false,
        emailVerificationToken: 'valid-token',
        emailVerificationExpiresAt: new Date(now + 60 * 60 * 1000),
      });
      mockUserRepository.update.mockResolvedValue({});

      const result = await service.verifyEmail('valid-token');

      expect(result).toEqual({
        message: 'E-mail confirmado com sucesso',
        email: 'test@example.com',
      });
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpiresAt: null,
        }),
      );
    });

    it('should return success without updating when email is already verified', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        emailVerified: true,
        emailVerificationToken: 'valid-token',
        emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const result = await service.verifyEmail('valid-token');

      expect(result).toEqual({
        message: 'E-mail confirmado com sucesso',
        email: 'test@example.com',
      });
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });

  // ─── resendEmailVerification ──────────────────────────────────────

  describe('resendEmailVerification', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(
        service.resendEmailVerification('unknown-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when email is already verified', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test',
        emailVerified: true,
      });
      await expect(service.resendEmailVerification('user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.resendEmailVerification('user-1')).rejects.toThrow(
        'Este e-mail já está confirmado',
      );
    });

    it('should dispatch email verification and return message', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
      });
      mockUserRepository.update.mockResolvedValue({});
      mockConfigService.get.mockReturnValue('https://app.inexci.com.br');

      const result = await service.resendEmailVerification('user-1');

      expect(result).toEqual({ message: 'E-mail de confirmação enviado' });
      expect(mockMailService.sendEmailVerification).toHaveBeenCalledWith(
        'test@example.com',
        expect.objectContaining({
          userName: 'Test User',
          email: 'test@example.com',
          verificationUrl: expect.stringContaining('/confirmar-email?token='),
        }),
      );
    });
  });

  // ─── register — dispatchEmailVerification ────────────────────────

  describe('register — dispatchEmailVerification', () => {
    it('should call dispatchEmailVerification after successful registration', async () => {
      const mockPlan = { id: 'plan-1', name: 'Básico', isActive: true };
      mockUserRepository.findOne.mockResolvedValue(null);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-pw');

      const createdUser = {
        id: 'mock-uuid-1234',
        name: 'Novo Usuário',
        email: 'novo@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: null,
        cpf: null,
        ownerId: 'mock-uuid-1234',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUserRepository.create.mockResolvedValue(createdUser);
      mockUserRepository.update.mockResolvedValue({});
      mockConfigService.get.mockReturnValue('https://app.inexci.com.br');

      await service.register({
        name: 'Novo Usuário',
        email: 'novo@example.com',
        password: '123456',
        phone: '11999998888',
        isDoctor: false,
      } as any);

      // dispatchEmailVerification é chamado via `void` — aguarda um tick
      await new Promise((r) => setImmediate(r));

      expect(mockMailService.sendEmailVerification).toHaveBeenCalledWith(
        'novo@example.com',
        expect.objectContaining({ email: 'novo@example.com' }),
      );
    });
  });

  // ─── register — WhatsApp welcome ─────────────────────────────────

  describe('register — WhatsApp welcome', () => {
    it('envia WhatsApp de boas-vindas quando o usuário tem telefone', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-pw');

      const createdUser = {
        id: 'mock-uuid-1234',
        name: 'Novo Usuário',
        email: 'novo@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: '11988887777',
        cpf: null,
        ownerId: 'mock-uuid-1234',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUserRepository.create.mockResolvedValue(createdUser);
      mockUserRepository.update.mockResolvedValue({});
      mockConfigService.get.mockReturnValue('https://app.inexci.com.br');

      await service.register({
        name: 'Novo Usuário',
        email: 'novo@example.com',
        password: '123456',
        phone: '11988887777',
        isDoctor: false,
      } as any);

      await new Promise((r) => setImmediate(r));

      expect(mockWhatsappService.sendUserWelcome).toHaveBeenCalledWith(
        '11988887777',
        'Novo Usuário',
      );
    });

    it('não envia WhatsApp quando o usuário não tem telefone', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-pw');

      const createdUser = {
        id: 'mock-uuid-1234',
        name: 'Sem Phone',
        email: 'sem@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: null,
        cpf: null,
        ownerId: 'mock-uuid-1234',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUserRepository.create.mockResolvedValue(createdUser);
      mockUserRepository.update.mockResolvedValue({});
      mockConfigService.get.mockReturnValue('https://app.inexci.com.br');

      await service.register({
        name: 'Sem Phone',
        email: 'sem@example.com',
        password: '123456',
        phone: '11999990000',
        isDoctor: false,
      } as any);

      await new Promise((r) => setImmediate(r));

      expect(mockWhatsappService.sendUserWelcome).not.toHaveBeenCalled();
    });
  });
});
