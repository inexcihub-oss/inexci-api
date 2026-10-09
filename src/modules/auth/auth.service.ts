import {
  isClinicalDocumentIssuerProfile,
  isPhysicianProfile,
} from 'src/database/entities/doctor-profile.entity';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import { HttpMessages } from 'src/common';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { ConfigService } from '@nestjs/config';
import { AuthDto } from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';
import { validationCodeDto } from './dto/validation-code.dto';
import { changePasswordDto } from './dto/change-password.dto';
import { ChangePasswordAuthenticatedDto } from './dto/change-password-authenticated.dto';
import { generateValidationCode } from 'src/shared/utils';
import { ConsentService } from '../privacy/consent.service';
import { normalizeOnboardingState } from '../onboarding/onboarding.merge';
import { SubscriptionService } from '../billing/services/subscription.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { BCRYPT_ROUNDS, precisaRehash } from 'src/shared/constants/bcrypt';
import { LogTrace } from 'src/shared/logging/trace.decorator';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { DEFAULT_PROCEDURE_NAMES } from '../procedures/default-procedures.constants';
import { RefreshTokenStore } from './refresh-token.store';
import { resolveEffectivePermissions } from 'src/shared/permissions';
import {
  assertCodigoUtilizavel,
  consumirTentativa,
} from './recovery-code-attempts.util';

export const PHONE_ALREADY_IN_USE_MESSAGE =
  'Este telefone já está sendo utilizado por outra conta.';

const PHONE_UNIQUE_INDEX = 'IDX_users_phone_unique';

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function isPhoneUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  const erro = err as {
    code?: string;
    constraint?: string;
    message?: string;
    driverError?: { code?: string; constraint?: string; message?: string };
  };
  const driver = erro.driverError ?? {};

  if ((erro.code ?? driver.code) !== '23505') return false;

  return (
    erro.constraint === PHONE_UNIQUE_INDEX ||
    driver.constraint === PHONE_UNIQUE_INDEX ||
    (erro.message ?? '').includes(PHONE_UNIQUE_INDEX) ||
    (driver.message ?? '').includes(PHONE_UNIQUE_INDEX)
  );
}

@Injectable()
@LogTrace()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly userRepository: UserRepository,
    private readonly recoveryCodeRepository: RecoveryCodeRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly mailService: MailService,
    private readonly whatsappService: WhatsappService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenStore: RefreshTokenStore,
    private readonly configService: ConfigService,
    private readonly consentService: ConsentService,
    private readonly subscriptionService: SubscriptionService,
    private readonly procedureRepository: ProcedureRepository,
    private readonly storageService: StorageService,
  ) {}

  private readonly EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

  private async createRefreshToken(userId: string): Promise<string> {
    return this.refreshTokenStore.issue(userId);
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne(
      { email, status: UserStatus.ACTIVE },
      true,
    );

    if (user && password) {
      if (!user.password) {
        throw new UnauthorizedException(
          'Conta sem senha definida. Acesse pelo link de primeiro acesso.',
        );
      }
      const isValid = await bcrypt.compare(password, user.password);

      if (!isValid) {
        throw new HttpException(
          HttpMessages.loginFailed,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!user.emailVerified) {
        throw new HttpException(
          'Confirme seu e-mail antes de fazer login. Verifique sua caixa de entrada.',
          HttpStatus.FORBIDDEN,
        );
      }

      if (precisaRehash(user.password)) {
        const novoHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await this.userRepository.update(user.id, { password: novoHash });
      }

      return user;
    } else {
      throw new HttpException(HttpMessages.loginFailed, HttpStatus.BAD_REQUEST);
    }
  }

  async checkEmailAvailability(
    email: string,
  ): Promise<{ status: 'available' | 'pending_invite' | 'registered' }> {
    const existingUser = await this.userRepository.findOne({ email });

    if (!existingUser) return { status: 'available' };
    if (existingUser.status === UserStatus.PENDING) {
      return { status: 'pending_invite' };
    }
    return { status: 'registered' };
  }

  async checkPhoneAvailability(
    phone: string,
  ): Promise<{ status: 'available' | 'registered' }> {
    const existingUser = await this.userRepository.findOne({
      phone: normalizePhone(phone),
    });

    return { status: existingUser ? 'registered' : 'available' };
  }

  async register(data: RegisterDto) {
    const existingUser = await this.userRepository.findOne({
      email: data.email,
    });

    if (existingUser) {
      if (existingUser.status === UserStatus.PENDING) {
        throw new HttpException(
          'Este e-mail está associado a um convite pendente. Verifique sua caixa de entrada para ativar sua conta.',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        'Este e-mail já está cadastrado. Faça login ou recupere sua senha.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const phoneDigits = normalizePhone(data.phone);

    const phoneOwner = await this.userRepository.findOne({
      phone: phoneDigits,
    });

    if (phoneOwner) {
      throw new HttpException(
        PHONE_ALREADY_IN_USE_MESSAGE,
        HttpStatus.BAD_REQUEST,
      );
    }

    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    const isDoctor = data.isDoctor || false;

    const userId = uuidv4();

    const user = await this.userRepository
      .create({
        id: userId,
        name: data.name,
        email: data.email,
        password: hashedPassword,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: phoneDigits,
        ownerId: userId,
      } as Partial<User>)
      .catch((err: unknown) => {
        if (isPhoneUniqueViolation(err)) {
          throw new HttpException(
            PHONE_ALREADY_IN_USE_MESSAGE,
            HttpStatus.BAD_REQUEST,
          );
        }
        throw err;
      });

    await Promise.all(
      DEFAULT_PROCEDURE_NAMES.map((name) =>
        this.procedureRepository.create({ name, ownerId: user.id }),
      ),
    );

    try {
      await this.subscriptionService.createInitialSubscription(
        user.id,
        data.planSlug,
      );
    } catch (err) {
      this.logger.error(
        `Falha ao criar subscription para userId=${user.id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    let doctorProfile = null;
    if (isDoctor) {
      doctorProfile = await this.doctorProfileRepository.create({
        userId: user.id,
        crm: data.crm || '',
        crmState: data.crmState || '',
        specialty: data.specialty || null,
      });
    }

    void this.dispatchEmailVerification(user.id, user.name, user.email);

    if (user.phone) {
      void this.whatsappService
        .sendUserWelcome(user.phone, user.name)
        .catch((err) => {
          this.logger.warn(
            `Falha ao enfileirar WhatsApp de boas-vindas para userId=${user.id}: ${err?.message ?? err}`,
          );
        });
    }

    return {
      user: {
        id: user.id.toString(),
        role: user.role,
        name: user.name,
        phone: user.phone,
        email: user.email,
        cpf: user.cpf,
        status: user.status,
        ownerId: user.ownerId,
        isDoctor: !!doctorProfile,
        isPhysician: isPhysicianProfile(doctorProfile),
        canIssueClinicalDocuments:
          isClinicalDocumentIssuerProfile(doctorProfile),
        emailVerified: user.emailVerified ?? false,
        permissions: resolveEffectivePermissions({
          role: user.role,
          permissions: user.permissions,
          isDoctor: !!doctorProfile,
          isPhysician: isPhysicianProfile(doctorProfile),
        }),
        doctorProfile: doctorProfile
          ? {
              id: doctorProfile.id,
              crm: doctorProfile.crm,
              crmState: doctorProfile.crmState,
              council: doctorProfile.council,
              specialty: doctorProfile.specialty,
              signatureUrl: doctorProfile.signatureUrl,
              clinicName: doctorProfile.clinicName,
            }
          : null,
        createdAt: user.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: user.updatedAt?.toISOString() || new Date().toISOString(),
      },
    };
  }

  async login(user: AuthDto) {
    const result = await this.validateUser(user.email, user.password);

    if (result) {
      const fullUser = await this.userRepository.findOneWithProfile({
        id: result.id,
      });
      const doctorProfile = fullUser?.doctorProfile ?? null;
      const account = await this.buildAccountInfo(result.id, fullUser?.ownerId);

      const refreshToken = await this.createRefreshToken(result.id);

      let pendingConsents: string[] = [];
      try {
        const status = await this.consentService.getStatus(result.id);
        pendingConsents = status.pendingRequired;
      } catch (err) {
        this.logger.error(
          `Falha ao verificar consentimentos no login do usuário ${result.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }

      return {
        user: {
          id: result.id.toString(),
          role: result.role,
          name: result.name,
          phone: result.phone,
          email: result.email,
          cpf: result.cpf,
          status: result.status,
          ownerId: fullUser?.ownerId,
          accountId: fullUser?.ownerId,
          account,
          isDoctor: !!doctorProfile,
          isPhysician: isPhysicianProfile(doctorProfile),
          canIssueClinicalDocuments:
            isClinicalDocumentIssuerProfile(doctorProfile),
          emailVerified: fullUser?.emailVerified ?? false,
          permissions: resolveEffectivePermissions({
            role: result.role,
            permissions: fullUser?.permissions,
            isDoctor: !!doctorProfile,
            isPhysician: isPhysicianProfile(doctorProfile),
          }),
          doctorProfile: doctorProfile
            ? {
                id: doctorProfile.id,
                crm: doctorProfile.crm,
                crmState: doctorProfile.crmState,
                council: doctorProfile.council,
                specialty: doctorProfile.specialty,
                signatureUrl: doctorProfile.signatureUrl,
                clinicName: doctorProfile.clinicName,
              }
            : null,
          createdAt:
            result.createdAt?.toISOString() || new Date().toISOString(),
          updatedAt:
            result.updatedAt?.toISOString() || new Date().toISOString(),
        },
        access_token: this.jwtService.sign({ userId: result.id }),
        refresh_token: refreshToken,
        pending_consents: pendingConsents,
      };
    }
    return null;
  }

  async me(userId: string) {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    const doctorProfile = user.doctorProfile ?? null;

    const [avatarUrl, signatureUrl, account] = await Promise.all([
      this.resolveStorageUrl(user.avatarUrl),
      this.resolveStorageUrl(doctorProfile?.signatureUrl),
      this.buildAccountInfo(user.id, user.ownerId),
    ]);

    return {
      id: user.id,
      role: user.role,
      name: user.name,
      phone: user.phone,
      email: user.email,
      ownerId: user.ownerId,
      accountId: user.ownerId,
      account,
      avatarUrl,
      isDoctor: !!doctorProfile,
      isPhysician: isPhysicianProfile(doctorProfile),
      canIssueClinicalDocuments: isClinicalDocumentIssuerProfile(doctorProfile),
      emailVerified: user.emailVerified ?? false,
      permissions: resolveEffectivePermissions({
        role: user.role,
        permissions: user.permissions,
        isDoctor: !!doctorProfile,
        isPhysician: isPhysicianProfile(doctorProfile),
      }),
      doctorProfile: doctorProfile
        ? {
            id: doctorProfile.id,
            crm: doctorProfile.crm,
            crmState: doctorProfile.crmState,
            council: doctorProfile.council,
            specialty: doctorProfile.specialty,
            signatureUrl,
            clinicName: doctorProfile.clinicName,
          }
        : null,
      consents: this.consentService.buildStatusFromUser(user),
      onboardingState: normalizeOnboardingState(user.onboardingState),
    };
  }

  private async buildAccountInfo(
    userId: string,
    ownerId?: string | null,
  ): Promise<{ ownerName: string; ownerIsDoctor: boolean } | null> {
    if (!ownerId || ownerId === userId) return null;
    const owner = await this.userRepository.findOneWithProfile({ id: ownerId });
    if (!owner) return null;
    return { ownerName: owner.name, ownerIsDoctor: !!owner.doctorProfile };
  }

  private async resolveStorageUrl(
    path?: string | null,
  ): Promise<string | null> {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    try {
      return await this.storageService.getSignedUrl(path);
    } catch {
      return null;
    }
  }

  private readonly GENERIC_RECOVERY_MESSAGE =
    'Se o e-mail existir, enviaremos um código de recuperação.';

  async sendRecoveryPasswordEmail(email: string) {
    const normalizedEmail = email.trim();
    const user = await this.userRepository.findOne({ email: normalizedEmail });

    if (!user) {
      return { message: this.GENERIC_RECOVERY_MESSAGE };
    }

    await this.recoveryCodeRepository.deleteMany({
      userId: user.id,
      used: false,
    });

    const validationCode = generateValidationCode();

    await this.recoveryCodeRepository.create({
      userId: user.id,
      used: false,
      code: validationCode,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    void this.mailService.sendPasswordRecovery(user.email, {
      userName: user.name,
      validationCode,
    });

    return { message: this.GENERIC_RECOVERY_MESSAGE };
  }

  private readonly RESET_TOKEN_EXPIRY_MS = 10 * 60 * 1000;

  async validateRecoveryPasswordCode(data: validationCodeDto) {
    const normalizedEmail = data.email.trim();
    const normalizedCode = data.code.trim().replace(/\s+/g, '');

    const user = await this.userRepository.findOne({ email: normalizedEmail });
    if (!user) throw new BadRequestException('Código inválido ou expirado');

    const registro = await this.recoveryCodeRepository.findOne({
      userId: user.id,
      used: false,
    });

    assertCodigoUtilizavel(registro);

    if (registro!.code !== normalizedCode) {
      await consumirTentativa(this.recoveryCodeRepository, registro!);
      throw new BadRequestException('Código inválido ou expirado');
    }

    const validationCode = registro!;

    const resetToken = uuidv4();
    await this.recoveryCodeRepository.updateByWhere(
      { id: validationCode.id },
      {
        used: true,
        resetToken,
        resetTokenExpiresAt: new Date(Date.now() + this.RESET_TOKEN_EXPIRY_MS),
      },
    );

    return { message: 'Código validado com sucesso', resetToken };
  }

  private invalidResetTokenError(): BadRequestException {
    return new BadRequestException(
      'Token de redefinição inválido. Reinicie a recuperação de senha.',
    );
  }

  async changePassword(data: changePasswordDto) {
    const normalizedEmail = data.email.trim();
    const normalizedResetToken = data.resetToken.trim();

    const user = await this.userRepository.findOne({ email: normalizedEmail });

    if (!user) throw this.invalidResetTokenError();

    const validatedCode = await this.recoveryCodeRepository.findOne({
      userId: user.id,
      resetToken: normalizedResetToken,
      used: true,
    });

    if (!validatedCode) {
      throw this.invalidResetTokenError();
    }

    if (
      !validatedCode.resetTokenExpiresAt ||
      new Date() > new Date(validatedCode.resetTokenExpiresAt)
    ) {
      throw new BadRequestException(
        'Token de redefinição expirado. Reinicie a recuperação de senha.',
      );
    }

    const password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    const now = new Date();
    const updatePayload: Partial<User> = { password };
    if (user.status === UserStatus.PENDING) {
      updatePayload.status = UserStatus.ACTIVE;
      updatePayload.emailVerified = true;
      updatePayload.emailVerifiedAt = now;
    }

    await this.userRepository.update(user.id, updatePayload);

    await this.recoveryCodeRepository.deleteMany({ userId: user.id });

    await this.revokeRefreshTokens(user.id);

    return { message: 'Senha alterada com sucesso' };
  }

  async changePasswordAuthenticated(
    data: ChangePasswordAuthenticatedDto,
    userId: string,
  ) {
    const user = await this.userRepository.findOne({ id: userId }, true);

    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (!user.password) {
      throw new UnauthorizedException(
        'Conta sem senha definida. Acesse pelo link de primeiro acesso.',
      );
    }
    const isPasswordValid = await bcrypt.compare(
      data.currentPassword,
      user.password,
    );

    if (!isPasswordValid) {
      throw new BadRequestException('Senha atual incorreta');
    }

    const newPasswordHash = await bcrypt.hash(data.newPassword, BCRYPT_ROUNDS);

    await this.userRepository.update(user.id, { password: newPasswordHash });

    return { message: 'Senha alterada com sucesso' };
  }

  async refreshAccessToken(token: string) {
    const consumed = await this.refreshTokenStore.consume(token);

    if (consumed.status === 'reused') {
      this.logger.error(
        `[AUTH_REUSE_DETECTED] Reuso de refresh token detectado para userId=${consumed.userId}. Revogando todos os tokens da família.`,
      );
      await this.revokeRefreshTokens(consumed.userId);
      throw new UnauthorizedException(
        'Sessão revogada por segurança. Faça login novamente.',
      );
    }

    if (consumed.status !== 'valid') {
      throw new BadRequestException('Refresh token inválido');
    }

    const user = await this.userRepository.findOne({ id: consumed.userId });
    if (!user || user.status !== UserStatus.ACTIVE || !user.emailVerified) {
      await this.revokeRefreshTokens(consumed.userId);
      throw new UnauthorizedException(
        'Sessão inválida. Confirme seu e-mail e faça login novamente.',
      );
    }

    const newRefreshToken = await this.createRefreshToken(consumed.userId);

    return {
      access_token: this.jwtService.sign({ userId: consumed.userId }),
      refresh_token: newRefreshToken,
    };
  }

  async revokeRefreshTokens(userId: string) {
    await this.refreshTokenStore.revokeAllForUser(userId);
  }

  private async dispatchEmailVerification(
    userId: string,
    userName: string,
    email: string,
  ): Promise<void> {
    try {
      const token = uuidv4();
      const expiresAt = new Date(
        Date.now() + this.EMAIL_VERIFICATION_EXPIRY_MS,
      );

      await this.userRepository.update(userId, {
        emailVerificationToken: token,
        emailVerificationExpiresAt: expiresAt,
      });

      const dashboardUrl =
        this.configService.get<string>('DASHBOARD_URL') || '';
      const verificationUrl = `${dashboardUrl}/confirmar-email?token=${token}`;

      await this.mailService.sendEmailVerification(email, {
        userName,
        email,
        verificationUrl,
      });
    } catch (err: any) {
      this.logger.warn(
        `Falha ao enviar e-mail de verificação para userId=${userId}: ${err?.message}`,
      );
    }
  }

  async verifyEmail(token: string) {
    if (!token) {
      throw new BadRequestException('Token de verificação inválido');
    }

    const user = await this.userRepository.findOne({
      emailVerificationToken: token,
    });

    if (!user) {
      throw new BadRequestException('Token de verificação inválido');
    }

    if (user.emailVerified) {
      return {
        message: 'E-mail confirmado com sucesso',
        email: user.email,
      };
    }

    if (
      user.emailVerificationExpiresAt &&
      new Date() > new Date(user.emailVerificationExpiresAt)
    ) {
      throw new BadRequestException(
        'O link de confirmação expirou. Solicite um novo e-mail.',
      );
    }

    const now = new Date();
    await this.userRepository.update(user.id, {
      emailVerified: true,
      emailVerifiedAt: now,
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
    });

    return {
      message: 'E-mail confirmado com sucesso',
      email: user.email,
    };
  }

  async resendEmailVerification(userId: string) {
    const user = await this.userRepository.findOne({ id: userId });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Este e-mail já está confirmado');
    }

    await this.dispatchEmailVerification(user.id, user.name, user.email);

    return { message: 'E-mail de confirmação enviado' };
  }
}
