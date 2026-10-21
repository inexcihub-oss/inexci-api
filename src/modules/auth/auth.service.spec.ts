import { Test, TestingModule } from '@nestjs/testing';
import {
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthService } from './auth.service';
import { RefreshTokenStore } from './refresh-token.store';
import { SessionRevocationService } from './session-revocation.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';
import { Permission } from 'src/shared/permissions';
import { ConfigService } from '@nestjs/config';
import { ConsentService } from '../privacy/consent.service';
import { SubscriptionService } from '../billing/services/subscription.service';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import { AuthAttemptLimiter } from './auth-attempt-limiter';
import { TurnstileService } from './turnstile.service';
import { RecoveryCodePurpose } from 'src/database/entities/recovery-code.entity';
import { MfaService } from './mfa/mfa.service';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));
import * as bcryptjs from 'bcryptjs';

jest.mock('uuid', () => ({ v4: () => 'mock-uuid-1234' }));
jest.mock('src/shared/utils', () => ({
  generateValidationCode: () => '123456',
}));

type SessaoLogin = Extract<
  Awaited<ReturnType<AuthService['login']>>,
  { user: unknown }
>;

describe('AuthService', () => {
  let service: AuthService;

  const mockUserRepository = {
    findOne: jest.fn(),
    findOneWithProfile: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    incrementTokenVersion: jest.fn(),
  };

  const mockRecoveryCodeRepository = {
    findOne: jest.fn(),
    findActive: jest.fn(),
    consumeAttempt: jest.fn(),
    issueResetToken: jest.fn(),
    create: jest.fn(),
    updateByWhere: jest.fn(),
    deleteMany: jest.fn(),
  };

  const mockAttemptLimiter = {
    isLoginLocked: jest.fn(),
    registerLoginFailure: jest.fn(),
    clearLoginFailures: jest.fn(),
    tryConsumeRecoveryIssue: jest.fn(),
    isRecoveryValidationLocked: jest.fn(),
    registerRecoveryFailure: jest.fn(),
  };

  const mockMfaService = {
    isEnabled: jest.fn(),
    createLoginToken: jest.fn(),
    verifyLoginToken: jest.fn(),
    verifySecondFactor: jest.fn(),
  };

  const mockTurnstileService = {
    assertHuman: jest.fn(),
  };

  const mockDoctorProfileRepository = {
    findByUserId: jest.fn(),
    create: jest.fn(),
  };

  const mockMailService = {
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
    buildStatusFromUser: jest.fn().mockReturnValue({
      privacyPolicyAcceptedAt: new Date('2026-01-01'),
      termsOfUseAcceptedAt: new Date('2026-01-02'),
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
        { provide: AuthAttemptLimiter, useValue: mockAttemptLimiter },
        { provide: TurnstileService, useValue: mockTurnstileService },
        SessionRevocationService,
        { provide: MfaService, useValue: mockMfaService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockAttemptLimiter.isLoginLocked.mockResolvedValue(false);
    mockAttemptLimiter.registerLoginFailure.mockResolvedValue(undefined);
    mockAttemptLimiter.clearLoginFailures.mockResolvedValue(undefined);
    mockAttemptLimiter.tryConsumeRecoveryIssue.mockResolvedValue(true);
    mockAttemptLimiter.isRecoveryValidationLocked.mockResolvedValue(false);
    mockAttemptLimiter.registerRecoveryFailure.mockResolvedValue(undefined);
    mockTurnstileService.assertHuman.mockResolvedValue(undefined);
    mockMfaService.isEnabled.mockResolvedValue(false);
    mockRecoveryCodeRepository.consumeAttempt.mockResolvedValue(1);
    mockRecoveryCodeRepository.issueResetToken.mockResolvedValue(true);
  });

  describe('me', () => {
    it('inclui consents embutidos sem query adicional ao ConsentService', async () => {
      const user = {
        id: 'user-1',
        role: UserRole.ADMIN,
        name: 'Test User',
        phone: '11999999999',
        email: 'test@example.com',
        ownerId: 'user-1',
        avatarUrl: null,
        emailVerified: true,
        privacyPolicyAcceptedAt: new Date('2026-01-01'),
        termsOfUseAcceptedAt: new Date('2026-01-02'),
        aiConsentAcceptedAt: null,
        doctorProfile: null,
      };
      mockUserRepository.findOneWithProfile.mockResolvedValue(user);

      const result = await service.me('user-1');

      expect(result.consents).toEqual({
        privacyPolicyAcceptedAt: new Date('2026-01-01'),
        termsOfUseAcceptedAt: new Date('2026-01-02'),
        aiConsentAcceptedAt: null,
        requiredConsentsAccepted: true,
        pendingRequired: [],
      });
      expect(mockConsentService.buildStatusFromUser).toHaveBeenCalledWith(user);
      expect(mockConsentService.getStatus).not.toHaveBeenCalled();
    });

    it.each([
      ['CRM', true, true],
      ['CRO', false, true],
      ['CRN', false, false],
    ])(
      'conselho %s: isPhysician=%s, canIssueClinicalDocuments=%s',
      async (council, isPhysician, emite) => {
        mockUserRepository.findOneWithProfile.mockResolvedValue({
          id: 'prof-1',
          role: UserRole.COLLABORATOR,
          name: 'Profissional',
          phone: '11999999999',
          email: 'prof@example.com',
          ownerId: 'prof-1',
          avatarUrl: null,
          emailVerified: true,
          doctorProfile: { id: 'dp-1', council, crm: '123', crmState: 'RJ' },
        });

        const result = await service.me('prof-1');

        expect(result.isPhysician).toBe(isPhysician);
        expect(result.canIssueClinicalDocuments).toBe(emite);
      },
    );

    it('inclui account (equipe) para colaborador vinculado a um dono médico', async () => {
      const collaborator = {
        id: 'collab-1',
        role: UserRole.COLLABORATOR,
        name: 'Cláudia',
        phone: '11999999999',
        email: 'claudia@example.com',
        ownerId: 'owner-1',
        avatarUrl: null,
        emailVerified: true,
        doctorProfile: null,
      };
      const owner = {
        id: 'owner-1',
        name: 'Dr. Diogo',
        doctorProfile: { id: 'dp-1', council: 'CRM' },
      };
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce(collaborator)
        .mockResolvedValueOnce(owner);

      const result = await service.me('collab-1');

      expect(result.account).toEqual({
        ownerName: 'Dr. Diogo',
        ownerIsDoctor: true,
      });
    });

    it('não inclui account para admin (dono da própria conta)', async () => {
      const admin = {
        id: 'user-1',
        role: UserRole.ADMIN,
        name: 'Admin',
        phone: '11999999999',
        email: 'admin@example.com',
        ownerId: 'user-1',
        avatarUrl: null,
        emailVerified: true,
        doctorProfile: null,
      };
      mockUserRepository.findOneWithProfile.mockResolvedValue(admin);

      const result = await service.me('user-1');

      expect(result.account).toBeNull();
    });

    it('devolve accountId (além de ownerId) para o dono da conta', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'dono-1',
        role: UserRole.ADMIN,
        name: 'Dono',
        phone: '11999999999',
        email: 'dono@example.com',
        ownerId: 'dono-1',
        avatarUrl: null,
        emailVerified: true,
        doctorProfile: null,
      });

      const result = await service.me('dono-1');

      expect(result.accountId).toBe('dono-1');
      expect(result.ownerId).toBe('dono-1');
    });

    it('devolve accountId apontando para o dono no caso do colaborador', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
          name: 'Cláudia',
          phone: '11999999999',
          email: 'claudia@example.com',
          ownerId: 'owner-1',
          avatarUrl: null,
          emailVerified: true,
          doctorProfile: null,
        })
        .mockResolvedValueOnce({
          id: 'owner-1',
          name: 'Dr. Diogo',
          doctorProfile: { id: 'dp-1', council: 'CRM' },
        });

      const result = await service.me('collab-1');

      expect(result.accountId).toBe('owner-1');
    });

    describe('permissions (achado Critical)', () => {
      it('devolve as cinco permissões para o dono da conta (admin)', async () => {
        mockUserRepository.findOneWithProfile.mockResolvedValue({
          id: 'dono-1',
          role: UserRole.ADMIN,
          name: 'Dono',
          phone: '11999999999',
          email: 'dono@example.com',
          ownerId: 'dono-1',
          avatarUrl: null,
          emailVerified: true,
          permissions: [],
          isPlatformAdmin: false,
          doctorProfile: null,
        });

        const result = await service.me('dono-1');

        expect(result.permissions).toEqual([
          Permission.AGENDA,
          Permission.ATENDIMENTO,
          Permission.SOLICITACOES,
          Permission.FINANCEIRO,
          Permission.ADMINISTRACAO,
        ]);
      });

      it('devolve Agenda, Atendimento e Solicitações para um médico colaborador', async () => {
        mockUserRepository.findOneWithProfile.mockResolvedValue({
          id: 'med-1',
          role: UserRole.COLLABORATOR,
          name: 'Dra. Médica',
          phone: '11999999999',
          email: 'medica@example.com',
          ownerId: 'dono-1',
          avatarUrl: null,
          emailVerified: true,
          permissions: [],
          isPlatformAdmin: false,
          doctorProfile: { id: 'dp-1', council: 'CRM' },
        });

        const result = await service.me('med-1');

        expect(result.permissions).toEqual([
          Permission.AGENDA,
          Permission.ATENDIMENTO,
          Permission.SOLICITACOES,
        ]);
      });

      it('devolve exatamente o array gravado para um colaborador não-médico', async () => {
        mockUserRepository.findOneWithProfile.mockResolvedValue({
          id: 'colab-1',
          role: UserRole.COLLABORATOR,
          name: 'Assistente',
          phone: '11999999999',
          email: 'assistente@example.com',
          ownerId: 'dono-1',
          avatarUrl: null,
          emailVerified: true,
          permissions: [Permission.AGENDA],
          isPlatformAdmin: false,
          doctorProfile: null,
        });

        const result = await service.me('colab-1');

        expect(result.permissions).toEqual([Permission.AGENDA]);
      });

      it('não devolve isPlatformAdmin nem a coluna crua de permissions', async () => {
        mockUserRepository.findOneWithProfile.mockResolvedValue({
          id: 'colab-1',
          role: UserRole.COLLABORATOR,
          name: 'Assistente',
          phone: '11999999999',
          email: 'assistente@example.com',
          ownerId: 'dono-1',
          avatarUrl: null,
          emailVerified: true,
          permissions: [],
          isPlatformAdmin: true,
          doctorProfile: { id: 'dp-1', council: 'CRM' },
        });

        const result = await service.me('colab-1');

        expect(result).not.toHaveProperty('isPlatformAdmin');
        expect(result.permissions).toEqual([
          Permission.AGENDA,
          Permission.ATENDIMENTO,
          Permission.SOLICITACOES,
        ]);
      });
    });

    describe('onboardingState', () => {
      it('devolve o estado de onboarding vazio para quem nunca começou', async () => {
        mockUserRepository.findOneWithProfile.mockResolvedValue({
          id: 'u1',
          role: 'admin',
          name: 'Dra. Ana',
          email: 'ana@inexci.com',
          phone: '11999999999',
          ownerId: 'u1',
          permissions: [],
          onboardingState: null,
        });

        const resultado = await service.me('u1');

        expect(resultado.onboardingState).toEqual(
          expect.objectContaining({
            status: 'not_started',
            completedSteps: {},
            toursSeen: {},
          }),
        );
      });

      it('devolve o estado gravado', async () => {
        mockUserRepository.findOneWithProfile.mockResolvedValue({
          id: 'u1',
          role: 'admin',
          name: 'Dra. Ana',
          email: 'ana@inexci.com',
          phone: '11999999999',
          ownerId: 'u1',
          permissions: [],
          onboardingState: {
            version: 1,
            status: 'in_progress',
            welcomeSeenAt: '2026-08-01T00:00:00.000Z',
            checklistDismissedAt: null,
            completedSteps: { 'criar-solicitacao': '2026-08-01T00:00:00.000Z' },
            toursSeen: {},
            restartedAt: null,
          },
        });

        const resultado = await service.me('u1');

        expect(resultado.onboardingState.status).toBe('in_progress');
        expect(resultado.onboardingState.welcomeSeenAt).toBe(
          '2026-08-01T00:00:00.000Z',
        );
      });
    });
  });

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

    it('usuário inexistente roda o bcrypt com hash fictício e conta a falha', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('$2a$12$hashficticio');
      (bcryptjs.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.validateUser('ninguem@example.com', 'qualquer'),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });

      expect(bcryptjs.compare).toHaveBeenCalledWith(
        'qualquer',
        '$2a$12$hashficticio',
      );
      expect(mockAttemptLimiter.registerLoginFailure).toHaveBeenCalledWith(
        'ninguem@example.com',
      );
    });

    it('resposta de conta inexistente e de senha errada é idêntica', async () => {
      const capturar = async () => {
        try {
          await service.validateUser('alvo@example.com', 'errada');
          throw new Error('deveria ter lançado');
        } catch (err: any) {
          return { status: err.getStatus?.(), body: err.getResponse?.() };
        }
      };
      (bcryptjs.compare as jest.Mock).mockResolvedValue(false);

      mockUserRepository.findOne.mockResolvedValue(null);
      const semConta = await capturar();
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const comConta = await capturar();

      expect(semConta).toEqual(comConta);
      expect(mockAttemptLimiter.registerLoginFailure).toHaveBeenCalledTimes(2);
    });

    it('senha errada registra falha para a conta', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      (bcryptjs.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.validateUser('test@example.com', 'errada'),
      ).rejects.toThrow(HttpException);

      expect(mockAttemptLimiter.registerLoginFailure).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(mockAttemptLimiter.clearLoginFailures).not.toHaveBeenCalled();
    });

    it('login bem-sucedido zera o contador de falhas', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);

      await service.validateUser('test@example.com', 'correta');

      expect(mockAttemptLimiter.clearLoginFailures).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(mockAttemptLimiter.registerLoginFailure).not.toHaveBeenCalled();
    });

    it('conta bloqueada responde 429 sem consultar o banco nem o bcrypt', async () => {
      mockAttemptLimiter.isLoginLocked.mockResolvedValue(true);

      await expect(
        service.validateUser('test@example.com', 'correta'),
      ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });

      expect(mockUserRepository.findOne).not.toHaveBeenCalled();
      expect(bcryptjs.compare).not.toHaveBeenCalled();
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

    it('revoga todas as sessões (refresh e access) depois de trocar a senha', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        password: 'hash-atual',
      });
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hash-novo');

      await service.changePasswordAuthenticated(
        { currentPassword: 'Atual123@', newPassword: 'Nova1234@' },
        'user-1',
      );

      expect(mockUserRepository.update).toHaveBeenCalledWith('user-1', {
        password: 'hash-novo',
      });
      expect(mockUserRepository.incrementTokenVersion).toHaveBeenCalledWith(
        'user-1',
      );
      expect(mockRefreshTokenStore.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
    });
  });

  describe('e-mail sem diferenciar maiúsculas', () => {
    it('login busca o e-mail normalizado', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      (bcryptjs.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.validateUser('  Fulano@Exemplo.COM ', 'x'),
      ).rejects.toBeInstanceOf(HttpException);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith(
        { email: 'fulano@exemplo.com', status: UserStatus.ACTIVE },
        true,
      );
      expect(mockAttemptLimiter.registerLoginFailure).toHaveBeenCalledWith(
        'fulano@exemplo.com',
      );
    });

    it('check-email e recuperação buscam o e-mail normalizado', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await service.checkEmailAvailability('Novo@Exemplo.com');
      await service.sendRecoveryPasswordEmail('Novo@Exemplo.com');

      expect(mockUserRepository.findOne).toHaveBeenNthCalledWith(1, {
        email: 'novo@exemplo.com',
      });
      expect(mockUserRepository.findOne).toHaveBeenNthCalledWith(2, {
        email: 'novo@exemplo.com',
      });
    });
  });

  describe('checkEmailAvailability', () => {
    it('deve retornar available quando o e-mail não existe', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.checkEmailAvailability('novo@example.com'),
      ).resolves.toEqual({ status: 'available' });
    });

    it('deve retornar pending_invite quando o e-mail tem convite pendente', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        email: 'pending@example.com',
        status: UserStatus.PENDING,
      });

      await expect(
        service.checkEmailAvailability('pending@example.com'),
      ).resolves.toEqual({ status: 'pending_invite' });
    });

    it('deve retornar registered quando o e-mail já tem conta ativa', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        email: 'existing@example.com',
        status: UserStatus.ACTIVE,
      });

      await expect(
        service.checkEmailAvailability('existing@example.com'),
      ).resolves.toEqual({ status: 'registered' });
    });
  });

  describe('checkPhoneAvailability', () => {
    it('deve retornar available quando o telefone não pertence a ninguém', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.checkPhoneAvailability('11999998888'),
      ).resolves.toEqual({ status: 'available' });
    });

    it('deve retornar registered quando o telefone já tem conta', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        phone: '11999998888',
      });

      await expect(
        service.checkPhoneAvailability('11999998888'),
      ).resolves.toEqual({ status: 'registered' });
    });

    it('deve canonizar o telefone e consultar também as variantes legadas', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await service.checkPhoneAvailability('+55 (11) 99999-8888');

      const [filtro] = mockUserRepository.findOne.mock.calls[0];
      expect(filtro).toEqual(
        expect.arrayContaining([
          { phone: '11999998888' },
          { phone: '5511999998888' },
          { phone: '+5511999998888' },
        ]),
      );
    });

    it('acusa como cadastrado o número gravado sem o nono dígito', async () => {
      mockUserRepository.findOne.mockImplementation((where: any) =>
        Promise.resolve(
          Array.isArray(where) &&
            where.some((w: { phone: string }) => w.phone === '1199998888')
            ? { id: 'legado' }
            : null,
        ),
      );

      await expect(
        service.checkPhoneAvailability('(11) 99999-8888'),
      ).resolves.toEqual({ status: 'registered' });
    });

    it('recusa telefone fora do formato brasileiro', async () => {
      await expect(service.checkPhoneAvailability('12345')).rejects.toThrow(
        /telefone brasileiro válido/,
      );
    });
  });

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

    it('should throw a friendly error when the phone already belongs to another account', async () => {
      mockUserRepository.findOne.mockImplementation((where: any) =>
        Promise.resolve(
          Array.isArray(where) &&
            where.some((w: { phone: string }) => w.phone === '5511999998888')
            ? { id: 'outro-user', phone: '5511999998888' }
            : null,
        ),
      );

      await expect(
        service.register({
          name: 'Test',
          email: 'novo@example.com',
          password: '123456',
          phone: '(11) 99999-8888',
          planSlug: 'basico',
        } as any),
      ).rejects.toThrow(
        'Este telefone já está sendo utilizado por outra conta.',
      );

      expect(mockUserRepository.create).not.toHaveBeenCalled();
    });

    it('should convert the unique phone violation into the same friendly error', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-password');

      const violacao = Object.assign(
        new Error(
          'duplicate key value violates unique constraint "IDX_users_phone_unique"',
        ),
        {
          code: '23505',
          constraint: 'IDX_users_phone_unique',
          driverError: {
            code: '23505',
            constraint: 'IDX_users_phone_unique',
          },
        },
      );
      mockUserRepository.create.mockRejectedValue(violacao);

      await expect(
        service.register({
          name: 'Test',
          email: 'novo@example.com',
          password: '123456',
          phone: '11999998888',
          planSlug: 'basico',
        } as any),
      ).rejects.toThrow(
        'Este telefone já está sendo utilizado por outra conta.',
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
      });

      expect(result.user.isDoctor).toBe(true);
      expect(result.user.doctorProfile).toEqual({
        id: 'profile-1',
        crm: '12345',
        crmState: 'SP',
        specialty: 'Cardiology',
        signatureUrl: null,
        clinicName: null,
      });
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
      });

      expect(result.user.isDoctor).toBe(false);
      expect(result.user.doctorProfile).toBeNull();
      expect(mockDoctorProfileRepository.create).not.toHaveBeenCalled();
      expect((result as Record<string, unknown>).access_token).toBeUndefined();
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
    });

    it('grava o telefone no formato canônico (sem DDI, com o nono dígito)', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-password');
      mockUserRepository.create.mockResolvedValue({
        id: 'mock-uuid-1234',
        name: 'Assistant',
        email: 'assistant@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: '11999998888',
        ownerId: 'mock-uuid-1234',
      });

      await service.register({
        name: 'Assistant',
        email: 'assistant@example.com',
        password: '123456',
        phone: '+55 (11) 9999-8888',
        isDoctor: false,
      });

      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '11999998888' }),
      );
    });

    it('devolve as cinco permissões (register só cria o dono/ADMIN da conta)', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      (bcryptjs.hash as jest.Mock).mockResolvedValue('hashed-password');

      mockUserRepository.create.mockResolvedValue({
        id: 'mock-uuid-1234',
        name: 'Dono',
        email: 'dono@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: null,
        cpf: null,
        ownerId: 'mock-uuid-1234',
        permissions: [],
        isPlatformAdmin: false,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      });

      const result = await service.register({
        name: 'Dono',
        email: 'dono@example.com',
        password: '123456',
        phone: '11999998888',
      });

      expect(result.user).not.toHaveProperty('isPlatformAdmin');
      expect(
        (result.user as { permissions: Permission[] }).permissions,
      ).toEqual([
        Permission.AGENDA,
        Permission.ATENDIMENTO,
        Permission.SOLICITACOES,
        Permission.FINANCEIRO,
        Permission.ADMINISTRACAO,
      ]);
    });
  });

  describe('login', () => {
    const mockAuthenticatedUser = (
      overrides: Record<string, unknown> = {},
    ) => ({
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
      ...overrides,
    });

    it('should return user data and access_token', async () => {
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);
      const authenticatedUser = mockAuthenticatedUser();
      mockUserRepository.findOne.mockResolvedValue(authenticatedUser);
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        ...authenticatedUser,
        permissions: [],
        isPlatformAdmin: false,
        doctorProfile: null,
      });

      const result = await service.login({
        email: 'test@example.com',
        password: '123456',
      });

      expect((result as SessaoLogin).user.id).toBe('user-1');
      expect((result as SessaoLogin).user.email).toBe('test@example.com');
      expect((result as SessaoLogin).access_token).toBe('mock-jwt-token');
      expect((result as SessaoLogin).user.isDoctor).toBe(false);
    });

    it('devolve accountId (além de ownerId) no payload do login', async () => {
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);
      const authenticatedUser = mockAuthenticatedUser();
      mockUserRepository.findOne.mockResolvedValue(authenticatedUser);
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        ...authenticatedUser,
        permissions: [],
        isPlatformAdmin: false,
        doctorProfile: null,
      });

      const result = await service.login({
        email: 'test@example.com',
        password: '123456',
      });

      expect((result as SessaoLogin).user.accountId).toBe('user-1');
      expect((result as SessaoLogin).user.ownerId).toBe('user-1');
    });

    describe('permissions (achado Critical)', () => {
      it('devolve as cinco permissões para o dono da conta (admin)', async () => {
        (bcryptjs.compare as jest.Mock).mockResolvedValue(true);
        const authenticatedUser = mockAuthenticatedUser({
          role: UserRole.ADMIN,
        });
        mockUserRepository.findOne.mockResolvedValue(authenticatedUser);
        mockUserRepository.findOneWithProfile.mockResolvedValue({
          ...authenticatedUser,
          permissions: [],
          isPlatformAdmin: false,
          doctorProfile: null,
        });

        const result = await service.login({
          email: 'test@example.com',
          password: '123456',
        });

        expect((result as SessaoLogin).user.permissions).toEqual([
          Permission.AGENDA,
          Permission.ATENDIMENTO,
          Permission.SOLICITACOES,
          Permission.FINANCEIRO,
          Permission.ADMINISTRACAO,
        ]);
      });

      it('devolve exatamente o array gravado para um colaborador comum', async () => {
        (bcryptjs.compare as jest.Mock).mockResolvedValue(true);
        const authenticatedUser = mockAuthenticatedUser({
          id: 'colab-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
        });
        mockUserRepository.findOne.mockResolvedValue(authenticatedUser);
        mockUserRepository.findOneWithProfile.mockResolvedValue({
          ...authenticatedUser,
          permissions: [Permission.SOLICITACOES],
          isPlatformAdmin: false,
          doctorProfile: null,
        });

        const result = await service.login({
          email: 'test@example.com',
          password: '123456',
        });

        expect((result as SessaoLogin).user.permissions).toEqual([
          Permission.SOLICITACOES,
        ]);
      });

      it('não devolve isPlatformAdmin nem a coluna crua de permissions', async () => {
        (bcryptjs.compare as jest.Mock).mockResolvedValue(true);
        const authenticatedUser = mockAuthenticatedUser({
          id: 'colab-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
        });
        mockUserRepository.findOne.mockResolvedValue(authenticatedUser);
        mockUserRepository.findOneWithProfile.mockResolvedValue({
          ...authenticatedUser,
          permissions: [],
          isPlatformAdmin: true,
          doctorProfile: { id: 'dp-1', council: 'CRM' },
        });

        const result = await service.login({
          email: 'test@example.com',
          password: '123456',
        });

        expect((result as SessaoLogin).user).not.toHaveProperty(
          'isPlatformAdmin',
        );
        expect((result as SessaoLogin).user.permissions).toEqual([
          Permission.AGENDA,
          Permission.ATENDIMENTO,
          Permission.SOLICITACOES,
        ]);
      });
    });
  });

  describe('refreshAccessToken', () => {
    it('rotaciona o token para um usuário ativo e verificado', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({
        status: 'valid',
        userId: 'user-1',
        familyId: 'fam-1',
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        emailVerified: true,
        tokenVersion: 3,
      });

      const result = await service.refreshAccessToken('rt-token');

      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.refresh_token).toBe('new-refresh-token');
      expect(mockRefreshTokenStore.consume).toHaveBeenCalledWith('rt-token');
      expect(mockRefreshTokenStore.issue).toHaveBeenCalledWith(
        'user-1',
        3,
        'fam-1',
      );
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        userId: 'user-1',
        tv: 3,
      });
    });

    it('na janela de graça emite um token da mesma família', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({
        status: 'grace',
        userId: 'user-1',
        familyId: 'fam-1',
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        emailVerified: true,
      });

      const result = await service.refreshAccessToken('rt-corrida');

      expect(result.refresh_token).toBe('new-refresh-token');
      expect(mockRefreshTokenStore.issue).toHaveBeenCalledWith(
        'user-1',
        0,
        'fam-1',
      );
    });

    it('recusa o refresh emitido antes de uma revogação concorrente (versão de sessão mudou)', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({
        status: 'valid',
        userId: 'user-1',
        familyId: 'fam-1',
        tokenVersion: 2,
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        emailVerified: true,
        tokenVersion: 3,
      });

      await expect(service.refreshAccessToken('rt-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });

    it('aceita o refresh quando a versão de sessão do token bate com a do usuário', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({
        status: 'valid',
        userId: 'user-1',
        familyId: 'fam-1',
        tokenVersion: 3,
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        emailVerified: true,
        tokenVersion: 3,
      });

      const result = await service.refreshAccessToken('rt-token');

      expect(result.refresh_token).toBe('new-refresh-token');
      expect(mockRefreshTokenStore.issue).toHaveBeenCalledWith(
        'user-1',
        3,
        'fam-1',
      );
    });

    it('token legado sem versão de sessão continua aceito até expirar', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({
        status: 'valid',
        userId: 'user-1',
        familyId: null,
        tokenVersion: null,
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        emailVerified: true,
        tokenVersion: 5,
      });

      await service.refreshAccessToken('rt-legado');

      expect(mockRefreshTokenStore.issue).toHaveBeenCalledWith(
        'user-1',
        5,
        null,
      );
    });

    it('graça esgotada devolve 409 sem emitir token nem revogar sessões', async () => {
      mockRefreshTokenStore.consume.mockResolvedValue({
        status: 'grace_exhausted',
        userId: 'user-1',
        familyId: 'fam-1',
      });

      await expect(service.refreshAccessToken('rt-corrida')).rejects.toThrow(
        ConflictException,
      );
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
      expect(mockRefreshTokenStore.revokeAllForUser).not.toHaveBeenCalled();
      expect(mockUserRepository.incrementTokenVersion).not.toHaveBeenCalled();
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
      expect(mockRefreshTokenStore.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
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
      expect(mockRefreshTokenStore.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(mockUserRepository.incrementTokenVersion).toHaveBeenCalledWith(
        'user-1',
      );
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
    });
  });

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
        purpose: RecoveryCodePurpose.PASSWORD_RESET,
      });

      const createCall = mockRecoveryCodeRepository.create.mock.calls[0][0];
      expect(createCall.userId).toBe('user-1');
      expect(createCall.purpose).toBe(RecoveryCodePurpose.PASSWORD_RESET);
      expect(createCall.used).toBe(false);
      expect(createCall.code).toBe('123456');
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

    it('não toca no convite de um colaborador pendente', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'collab-1',
        email: 'pendente@example.com',
        name: 'Pendente',
        status: UserStatus.PENDING,
      });

      const result = await service.sendRecoveryPasswordEmail(
        'pendente@example.com',
      );

      expect(result).toEqual({ message: GENERIC_RECOVERY_MESSAGE });
      expect(mockRecoveryCodeRepository.deleteMany).not.toHaveBeenCalled();
      expect(mockRecoveryCodeRepository.create).not.toHaveBeenCalled();
      expect(mockMailService.sendPasswordRecovery).not.toHaveBeenCalled();
    });

    it('limite de códigos por conta: responde genérico sem gerar código nem e-mail', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test',
        status: UserStatus.ACTIVE,
      });
      mockAttemptLimiter.tryConsumeRecoveryIssue.mockResolvedValue(false);

      const result =
        await service.sendRecoveryPasswordEmail('test@example.com');

      expect(result).toEqual({ message: GENERIC_RECOVERY_MESSAGE });
      expect(mockAttemptLimiter.tryConsumeRecoveryIssue).toHaveBeenCalledWith(
        'user-1',
      );
      expect(mockRecoveryCodeRepository.create).not.toHaveBeenCalled();
      expect(mockMailService.sendPasswordRecovery).not.toHaveBeenCalled();
    });

    it('conta com validação travada não recebe código novo', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test',
        status: UserStatus.ACTIVE,
      });
      mockAttemptLimiter.isRecoveryValidationLocked.mockResolvedValue(true);

      const result =
        await service.sendRecoveryPasswordEmail('test@example.com');

      expect(result).toEqual({ message: GENERIC_RECOVERY_MESSAGE });
      expect(mockRecoveryCodeRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('validateRecoveryPasswordCode', () => {
    it('should throw NotFoundException when code is invalid', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findActive.mockResolvedValue(null);

      await expect(
        service.validateRecoveryPasswordCode({
          code: 'bad-code',
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Código inválido');
    });

    it('escopa por usuário sem revelar a existência da conta', async () => {
      const capture = async () => {
        try {
          await service.validateRecoveryPasswordCode({
            code: '123456',
            email: 'alvo@example.com',
          });
          throw new Error('deveria ter lançado');
        } catch (err: any) {
          return {
            status: err.getStatus?.(),
            message: err.getResponse?.()?.message ?? err.message,
          };
        }
      };

      mockUserRepository.findOne.mockResolvedValue(null);
      const semConta = await capture();
      expect(mockRecoveryCodeRepository.findActive).not.toHaveBeenCalled();

      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'alvo@example.com',
      });
      mockRecoveryCodeRepository.findActive.mockResolvedValue(null);
      const comConta = await capture();

      expect(semConta).toEqual(comConta);
      expect(semConta.status).toBe(400);
    });

    it('should throw BadRequestException when code is expired', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findActive.mockResolvedValue({
        id: 'code-1',
        code: '123456',
        used: false,
        expiresAt: new Date(Date.now() - 60 * 1000),
      });

      await expect(
        service.validateRecoveryPasswordCode({
          code: '123456',
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Código inválido ou expirado');
    });

    it('marca o código como usado e emite um reset token', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockRecoveryCodeRepository.findActive.mockResolvedValue({
        id: 'code-1',
        code: '123456',
        used: false,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const result = await service.validateRecoveryPasswordCode({
        code: '123456',
        email: 'test@example.com',
      });

      expect(result).toEqual({
        message: 'Código validado com sucesso',
        resetToken: 'mock-uuid-1234',
      });
      expect(mockRecoveryCodeRepository.findActive).toHaveBeenCalledWith(
        'user-1',
        RecoveryCodePurpose.PASSWORD_RESET,
      );
      expect(mockRecoveryCodeRepository.consumeAttempt).toHaveBeenCalledWith(
        'code-1',
        5,
      );
      expect(mockRecoveryCodeRepository.issueResetToken).toHaveBeenCalledWith(
        'code-1',
        'mock-uuid-1234',
        expect.any(Date),
      );
    });

    const registroValido = () => ({
      id: 'code-1',
      code: '123456',
      used: false,
      attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    it('colaborador pendente só valida código de convite', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'collab-1',
        email: 'pendente@example.com',
        status: UserStatus.PENDING,
      });
      mockRecoveryCodeRepository.findActive.mockResolvedValue(registroValido());

      await service.validateRecoveryPasswordCode({
        code: '123456',
        email: 'pendente@example.com',
      });

      expect(mockRecoveryCodeRepository.findActive).toHaveBeenCalledWith(
        'collab-1',
        RecoveryCodePurpose.INVITE,
      );
    });

    it('não compara o código quando a tentativa não foi registrada (corrida ou limite)', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        status: UserStatus.ACTIVE,
      });
      mockRecoveryCodeRepository.findActive.mockResolvedValue(registroValido());
      mockRecoveryCodeRepository.consumeAttempt.mockResolvedValue(null);

      await expect(
        service.validateRecoveryPasswordCode({
          code: '123456',
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Código inválido ou expirado');

      expect(mockRecoveryCodeRepository.issueResetToken).not.toHaveBeenCalled();
      expect(mockAttemptLimiter.registerRecoveryFailure).toHaveBeenCalledWith(
        'test@example.com',
      );
    });

    it('código errado conta falha para a conta e não emite reset token', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        status: UserStatus.ACTIVE,
      });
      mockRecoveryCodeRepository.findActive.mockResolvedValue(registroValido());

      await expect(
        service.validateRecoveryPasswordCode({
          code: '654321',
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Código inválido ou expirado');

      expect(mockRecoveryCodeRepository.consumeAttempt).toHaveBeenCalled();
      expect(mockAttemptLimiter.registerRecoveryFailure).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(mockRecoveryCodeRepository.issueResetToken).not.toHaveBeenCalled();
    });

    it('duas validações simultâneas do mesmo código: só uma recebe reset token', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        status: UserStatus.ACTIVE,
      });
      mockRecoveryCodeRepository.findActive.mockResolvedValue(registroValido());
      mockRecoveryCodeRepository.issueResetToken.mockResolvedValue(false);

      await expect(
        service.validateRecoveryPasswordCode({
          code: '123456',
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Código inválido ou expirado');
    });

    it('conta travada por falhas acumuladas responde 429 sem consultar o banco', async () => {
      mockAttemptLimiter.isRecoveryValidationLocked.mockResolvedValue(true);

      await expect(
        service.validateRecoveryPasswordCode({
          code: '123456',
          email: 'test@example.com',
        }),
      ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });

      expect(mockUserRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('e-mail inexistente é indistinguível de reset token inválido', async () => {
      const capture = async () => {
        try {
          await service.changePassword({
            email: 'alvo@example.com',
            resetToken: 'token-inventado',
            password: 'new',
          });
          throw new Error('deveria ter lançado');
        } catch (err: any) {
          return {
            status: err.getStatus?.(),
            message: err.getResponse?.()?.message ?? err.message,
          };
        }
      };

      mockUserRepository.findOne.mockResolvedValue(null);
      const semConta = await capture();

      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'alvo@example.com',
      });
      mockRecoveryCodeRepository.findOne.mockResolvedValue(null);
      const comConta = await capture();

      expect(semConta).toEqual(comConta);
      expect(semConta.status).toBe(400);
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
        resetTokenExpiresAt: new Date(Date.now() - 60 * 1000),
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
      });

      expect(result).toEqual({ message: 'Senha alterada com sucesso' });

      expect(bcryptjs.hash).toHaveBeenCalledWith('new-password-123', 12);

      const updateCall = mockUserRepository.update.mock.calls[0];
      expect(updateCall[0]).toBe('user-1');
      expect(updateCall[1].password).toBe('hashed-new-password');

      expect(mockRecoveryCodeRepository.deleteMany).toHaveBeenCalledWith({
        userId: 'user-1',
      });
    });
  });

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

    it('envia o WhatsApp de boas-vindas ao confirmar o e-mail', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        name: 'Novo Usuário',
        email: 'test@example.com',
        phone: '11988887777',
        emailVerified: false,
        emailVerificationToken: 'valid-token',
        emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      mockUserRepository.update.mockResolvedValue({});

      await service.verifyEmail('valid-token');
      await new Promise((r) => setImmediate(r));

      expect(mockWhatsappService.sendUserWelcome).toHaveBeenCalledWith(
        '11988887777',
        'Novo Usuário',
      );
    });

    it('não envia WhatsApp quando o token expirou nem quando já estava confirmado', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        name: 'Novo Usuário',
        email: 'test@example.com',
        phone: '11988887777',
        emailVerified: false,
        emailVerificationToken: 'expired-token',
        emailVerificationExpiresAt: new Date(Date.now() - 60_000),
      });
      await expect(service.verifyEmail('expired-token')).rejects.toThrow();

      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        name: 'Novo Usuário',
        email: 'test@example.com',
        phone: '11988887777',
        emailVerified: true,
        emailVerificationToken: 'valid-token',
      });
      await service.verifyEmail('valid-token');
      await new Promise((r) => setImmediate(r));

      expect(mockWhatsappService.sendUserWelcome).not.toHaveBeenCalled();
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
          verificationUrl: expect.stringContaining('/confirmar-email#token='),
        }),
      );
    });
  });

  describe('register — captcha', () => {
    it('valida o captcha com o token e o IP antes de qualquer consulta', async () => {
      mockTurnstileService.assertHuman.mockRejectedValue(
        new BadRequestException('captcha'),
      );

      await expect(
        service.register(
          {
            name: 'Bot',
            email: 'bot@example.com',
            password: 'Senha@123',
            phone: '11988887777',
            captchaToken: 'tok-1',
          },
          '203.0.113.9',
        ),
      ).rejects.toThrow('captcha');

      expect(mockTurnstileService.assertHuman).toHaveBeenCalledWith(
        'tok-1',
        '203.0.113.9',
      );
      expect(mockUserRepository.findOne).not.toHaveBeenCalled();
      expect(mockUserRepository.create).not.toHaveBeenCalled();
    });
  });

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
      });

      await new Promise((r) => setImmediate(r));

      expect(mockMailService.sendEmailVerification).toHaveBeenCalledWith(
        'novo@example.com',
        expect.objectContaining({ email: 'novo@example.com' }),
      );
    });
  });

  describe('register — WhatsApp welcome', () => {
    it('não envia WhatsApp no cadastro: o telefone ainda não foi verificado', async () => {
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
      });

      await new Promise((r) => setImmediate(r));

      expect(mockWhatsappService.sendUserWelcome).not.toHaveBeenCalled();
      expect(mockMailService.sendEmailVerification).toHaveBeenCalled();
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
      });

      await new Promise((r) => setImmediate(r));

      expect(mockWhatsappService.sendUserWelcome).not.toHaveBeenCalled();
    });
  });

  describe('MFA', () => {
    const usuarioAtivo = (overrides: Record<string, unknown> = {}) => ({
      id: 'user-1',
      email: 'test@example.com',
      password: 'hashed-password',
      role: UserRole.ADMIN,
      name: 'Test User',
      phone: '123',
      cpf: null,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      ownerId: 'user-1',
      tokenVersion: 2,
      permissions: [],
      doctorProfile: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      ...overrides,
    });

    it('login com MFA ativo não emite token nem refresh: devolve só o desafio', async () => {
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);
      mockUserRepository.findOne.mockResolvedValue(usuarioAtivo());
      mockMfaService.isEnabled.mockResolvedValue(true);
      mockMfaService.createLoginToken.mockReturnValue('mfa-token');

      const result = await service.login({
        email: 'test@example.com',
        password: 'Senha123@',
      });

      expect(result).toEqual({ mfaRequired: true, mfaToken: 'mfa-token' });
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
      expect(mockJwtService.sign).not.toHaveBeenCalled();
      expect(mockMfaService.createLoginToken).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', tokenVersion: 2 }),
      );
    });

    it('senha errada com MFA ativo nem chega a consultar o MFA', async () => {
      (bcryptjs.compare as jest.Mock).mockResolvedValue(false);
      mockUserRepository.findOne.mockResolvedValue(usuarioAtivo());

      await expect(
        service.login({ email: 'test@example.com', password: 'x' }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockMfaService.isEnabled).not.toHaveBeenCalled();
    });

    it('login/mfa com código válido emite a sessão completa', async () => {
      mockMfaService.verifyLoginToken.mockReturnValue({
        userId: 'user-1',
        tv: 2,
      });
      mockMfaService.verifySecondFactor.mockResolvedValue('totp');
      mockUserRepository.findOne.mockResolvedValue(usuarioAtivo());
      mockUserRepository.findOneWithProfile.mockResolvedValue(usuarioAtivo());

      const result = await service.loginWithMfa({
        mfaToken: 'mfa-token',
        code: '123456',
      });

      expect(mockMfaService.verifySecondFactor).toHaveBeenCalledWith(
        'user-1',
        '123456',
        { allowRecovery: true },
      );
      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.refresh_token).toBe('new-refresh-token');
      expect(result.user.id).toBe('user-1');
    });

    it('login/mfa recusa desafio emitido antes de uma revogação de sessões', async () => {
      mockMfaService.verifyLoginToken.mockReturnValue({
        userId: 'user-1',
        tv: 1,
      });
      mockUserRepository.findOne.mockResolvedValue(usuarioAtivo());

      await expect(
        service.loginWithMfa({ mfaToken: 't', code: '123456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockMfaService.verifySecondFactor).not.toHaveBeenCalled();
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
    });

    it('login/mfa recusa conta inativa ou inexistente', async () => {
      mockMfaService.verifyLoginToken.mockReturnValue({
        userId: 'user-1',
        tv: 2,
      });
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.loginWithMfa({ mfaToken: 't', code: '123456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        id: 'user-1',
        status: UserStatus.ACTIVE,
      });
    });

    it('login/mfa com código errado não emite sessão', async () => {
      mockMfaService.verifyLoginToken.mockReturnValue({
        userId: 'user-1',
        tv: 2,
      });
      mockUserRepository.findOne.mockResolvedValue(usuarioAtivo());
      mockMfaService.verifySecondFactor.mockRejectedValue(
        new BadRequestException('Código de verificação inválido.'),
      );

      await expect(
        service.loginWithMfa({ mfaToken: 't', code: '000000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRefreshTokenStore.issue).not.toHaveBeenCalled();
    });

    it('issueSessionTokens assina com o tokenVersion atual', async () => {
      mockUserRepository.findOne.mockResolvedValue(
        usuarioAtivo({ tokenVersion: 7 }),
      );

      const tokens = await service.issueSessionTokens('user-1');

      expect(mockJwtService.sign).toHaveBeenCalledWith({
        userId: 'user-1',
        tv: 7,
      });
      expect(tokens).toEqual({
        access_token: 'mock-jwt-token',
        refresh_token: 'new-refresh-token',
      });
    });

    it('me informa mfaEnabled e recomenda MFA para quem administra', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue(usuarioAtivo());
      mockMfaService.isEnabled.mockResolvedValue(false);

      const result = await service.me('user-1');

      expect(result.mfaEnabled).toBe(false);
      expect(result.mfaRecommended).toBe(true);
      expect(result).not.toHaveProperty('mfaSecret');
      expect(result).not.toHaveProperty('mfaRecoveryCodes');
    });

    it('me não recomenda MFA quando já está ativo', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue(usuarioAtivo());
      mockMfaService.isEnabled.mockResolvedValue(true);

      const result = await service.me('user-1');

      expect(result.mfaEnabled).toBe(true);
      expect(result.mfaRecommended).toBe(false);
    });

    it('me não recomenda MFA para colaborador sem administração', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue(
        usuarioAtivo({
          role: UserRole.COLLABORATOR,
          permissions: [Permission.AGENDA],
          ownerId: 'owner-1',
        }),
      );

      const result = await service.me('user-1');

      expect(result.mfaEnabled).toBe(false);
      expect(result.mfaRecommended).toBe(false);
    });

    it('me recomenda MFA para admin delegado (colaborador com ADMINISTRACAO)', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue(
        usuarioAtivo({
          role: UserRole.COLLABORATOR,
          permissions: [Permission.ADMINISTRACAO],
          ownerId: 'owner-1',
        }),
      );

      const result = await service.me('user-1');

      expect(result.mfaRecommended).toBe(true);
    });
  });
});
