import { Test, TestingModule } from '@nestjs/testing';
import {
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuthService } from './auth.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { SubscriptionPlan } from 'src/database/entities/subscription-plan.entity';
import { RefreshToken } from 'src/database/entities/refresh-token.entity';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';
import { ConfigService } from '@nestjs/config';

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

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
  };

  const mockSubscriptionPlanRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockRefreshTokenRepo = {
    save: jest.fn().mockResolvedValue({}),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
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
        { provide: JwtService, useValue: mockJwtService },
        {
          provide: getRepositoryToken(SubscriptionPlan),
          useValue: mockSubscriptionPlanRepo,
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: mockRefreshTokenRepo,
        },
        { provide: ConfigService, useValue: mockConfigService },
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
  });

  // ─── register ───────────────────────────────────────────────────

  describe('register', () => {
    const mockPlan = { id: 'plan-1', name: 'Básico', is_active: true };

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
      mockSubscriptionPlanRepo.findOne.mockResolvedValue(mockPlan);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-password');

      const createdUser = {
        id: 'mock-uuid-1234',
        name: 'Dr. Test',
        email: 'doctor@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: null,
        cpf: null,
        account_id: 'mock-uuid-1234',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };
      mockUserRepository.create.mockResolvedValue(createdUser);

      const createdProfile = {
        id: 'profile-1',
        crm: '12345',
        crm_state: 'SP',
        specialty: 'Cardiology',
        signature_url: null,
        clinic_name: null,
      };
      mockDoctorProfileRepository.create.mockResolvedValue(createdProfile);

      const result = await service.register({
        name: 'Dr. Test',
        email: 'doctor@example.com',
        password: '123456',
        is_doctor: true,
        crm: '12345',
        crm_state: 'SP',
        specialty: 'Cardiology',
      } as any);

      expect(result.user.is_doctor).toBe(true);
      expect(result.user.doctor_profile).toEqual({
        id: 'profile-1',
        crm: '12345',
        crm_state: 'SP',
        specialty: 'Cardiology',
        signature_url: null,
        clinic_name: null,
      });
      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.refresh_token).toBeDefined();
      expect(mockDoctorProfileRepository.create).toHaveBeenCalled();
    });

    it('should create user without doctor profile when is_doctor is false', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      mockSubscriptionPlanRepo.findOne.mockResolvedValue(mockPlan);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-password');

      const createdUser = {
        id: 'mock-uuid-1234',
        name: 'Assistant',
        email: 'assistant@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: null,
        cpf: null,
        account_id: 'mock-uuid-1234',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };
      mockUserRepository.create.mockResolvedValue(createdUser);

      const result = await service.register({
        name: 'Assistant',
        email: 'assistant@example.com',
        password: '123456',
        is_doctor: false,
      } as any);

      expect(result.user.is_doctor).toBe(false);
      expect(result.user.doctor_profile).toBeNull();
      expect(mockDoctorProfileRepository.create).not.toHaveBeenCalled();
      expect(result.access_token).toBe('mock-jwt-token');
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
        account_id: 'user-1',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      // validateUser calls findOne with status + selectPassword
      mockUserRepository.findOne.mockImplementation(
        (where, selectPassword?) => {
          if (selectPassword) return Promise.resolve(mockUser); // validateUser call
          return Promise.resolve({ ...mockUser, account_id: 'user-1' }); // fullUser call
        },
      );

      mockDoctorProfileRepository.findByUserId.mockResolvedValue(null);

      const result = await service.login({
        email: 'test@example.com',
        password: '123456',
      });

      expect(result.user.id).toBe('user-1');
      expect(result.user.email).toBe('test@example.com');
      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.user.is_doctor).toBe(false);
    });
  });

  // ─── sendRecoveryPasswordEmail ──────────────────────────────────

  describe('sendRecoveryPasswordEmail', () => {
    it('should throw NotFoundException when email is unknown', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.sendRecoveryPasswordEmail('unknown@example.com'),
      ).rejects.toThrow(NotFoundException);
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

      expect(result).toEqual({ message: 'E-mail enviado com sucesso' });
      expect(mockRecoveryCodeRepository.deleteMany).toHaveBeenCalledWith({
        user_id: 'user-1',
        used: false,
      });

      const createCall = mockRecoveryCodeRepository.create.mock.calls[0][0];
      expect(createCall.user_id).toBe('user-1');
      expect(createCall.used).toBe(false);
      expect(createCall.code).toBe('123456');
      // Verify expiry is ~15 minutes from now
      const expiresAt = createCall.expires_at.getTime();
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
      mockRecoveryCodeRepository.findOne.mockResolvedValue(null);

      await expect(
        service.validateRecoveryPasswordCode({
          code: 'bad-code',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.validateRecoveryPasswordCode({
          code: 'bad-code',
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Código inválido');
    });

    it('should throw BadRequestException when code is expired', async () => {
      mockRecoveryCodeRepository.findOne.mockResolvedValue({
        id: 'code-1',
        code: '123456',
        used: false,
        expires_at: new Date(Date.now() - 60 * 1000), // expired 1 minute ago
      });

      await expect(
        service.validateRecoveryPasswordCode({
          code: '123456',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(BadRequestException);

      mockRecoveryCodeRepository.findOne.mockResolvedValue({
        id: 'code-1',
        code: '123456',
        used: false,
        expires_at: new Date(Date.now() - 60 * 1000),
      });

      await expect(
        service.validateRecoveryPasswordCode({
          code: '123456',
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Código expirado');
    });

    it('should mark code as used when valid and not expired', async () => {
      mockRecoveryCodeRepository.findOne.mockResolvedValue({
        id: 'code-1',
        code: '123456',
        used: false,
        expires_at: new Date(Date.now() + 10 * 60 * 1000), // expires in 10 min
      });
      mockRecoveryCodeRepository.updateByWhere.mockResolvedValue({});

      const result = await service.validateRecoveryPasswordCode({
        code: '123456',
        email: 'test@example.com',
      });

      expect(result).toEqual({ message: 'Código validado com sucesso' });
      expect(mockRecoveryCodeRepository.updateByWhere).toHaveBeenCalledWith(
        { id: 'code-1' },
        { used: true },
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
          password: 'new',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when no validated recovery code exists', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findOne.mockResolvedValue(null);

      await expect(
        service.changePassword({
          email: 'test@example.com',
          password: 'new',
        } as any),
      ).rejects.toThrow(BadRequestException);

      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findOne.mockResolvedValue(null);

      await expect(
        service.changePassword({
          email: 'test@example.com',
          password: 'new',
        } as any),
      ).rejects.toThrow('Nenhum código de recuperação validado encontrado');
    });

    it('should hash the new password, save it, and delete recovery codes', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findOne.mockResolvedValue({
        id: 'code-1',
        user_id: 'user-1',
        used: true,
      });
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-new-password');
      mockUserRepository.update.mockResolvedValue({});
      mockRecoveryCodeRepository.deleteMany.mockResolvedValue(undefined);

      const result = await service.changePassword({
        email: 'test@example.com',
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
        user_id: 'user-1',
      });
    });
  });

  // ─── verifyEmail ─────────────────────────────────────────────────

  describe('verifyEmail', () => {
    it('should throw BadRequestException when token is empty', async () => {
      await expect(service.verifyEmail('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when token does not exist', async () => {
      mockEmailVerificationRepository.findOne.mockResolvedValue(null);
      await expect(service.verifyEmail('invalid-token')).rejects.toThrow(
        'Token de verificação inválido',
      );
    });

    it('should throw BadRequestException when token was already used', async () => {
      mockEmailVerificationRepository.findOne.mockResolvedValue({
        id: 'ev-1',
        user_id: 'user-1',
        token: 'used-token',
        used: true,
        expires_at: new Date(Date.now() + 60_000),
      });
      await expect(service.verifyEmail('used-token')).rejects.toThrow(
        'Este link de confirmação já foi utilizado',
      );
    });

    it('should throw BadRequestException when token is expired', async () => {
      mockEmailVerificationRepository.findOne.mockResolvedValue({
        id: 'ev-1',
        user_id: 'user-1',
        token: 'expired-token',
        used: false,
        expires_at: new Date(Date.now() - 60_000), // 1 min atrás
      });
      await expect(service.verifyEmail('expired-token')).rejects.toThrow(
        'O link de confirmação expirou',
      );
    });

    it('should confirm email and return message + email on valid token', async () => {
      const now = Date.now();
      mockEmailVerificationRepository.findOne.mockResolvedValue({
        id: 'ev-1',
        user_id: 'user-1',
        token: 'valid-token',
        used: false,
        expires_at: new Date(now + 60 * 60 * 1000),
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        email_verified: false,
      });
      mockEmailVerificationRepository.updateByWhere.mockResolvedValue({});
      mockUserRepository.update.mockResolvedValue({});

      const result = await service.verifyEmail('valid-token');

      expect(result).toEqual({
        message: 'E-mail confirmado com sucesso',
        email: 'test@example.com',
      });
      expect(
        mockEmailVerificationRepository.updateByWhere,
      ).toHaveBeenCalledWith(
        { id: 'ev-1' },
        expect.objectContaining({ used: true }),
      );
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ email_verified: true }),
      );
    });

    it('should not update user when email is already verified', async () => {
      mockEmailVerificationRepository.findOne.mockResolvedValue({
        id: 'ev-1',
        user_id: 'user-1',
        token: 'valid-token',
        used: false,
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        email_verified: true,
      });
      mockEmailVerificationRepository.updateByWhere.mockResolvedValue({});

      await service.verifyEmail('valid-token');

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
        email_verified: true,
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
        email_verified: false,
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
      const mockPlan = { id: 'plan-1', name: 'Básico', is_active: true };
      mockUserRepository.findOne.mockResolvedValue(null);
      mockSubscriptionPlanRepo.findOne.mockResolvedValue(mockPlan);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-pw');

      const createdUser = {
        id: 'mock-uuid-1234',
        name: 'Novo Usuário',
        email: 'novo@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: null,
        cpf: null,
        account_id: 'mock-uuid-1234',
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockUserRepository.create.mockResolvedValue(createdUser);
      mockUserRepository.update.mockResolvedValue({});
      mockConfigService.get.mockReturnValue('https://app.inexci.com.br');

      await service.register({
        name: 'Novo Usuário',
        email: 'novo@example.com',
        password: '123456',
        is_doctor: false,
      } as any);

      // dispatchEmailVerification é chamado via `void` — aguarda um tick
      await new Promise((r) => setImmediate(r));

      expect(mockMailService.sendEmailVerification).toHaveBeenCalledWith(
        'novo@example.com',
        expect.objectContaining({ email: 'novo@example.com' }),
      );
    });
  });
});
