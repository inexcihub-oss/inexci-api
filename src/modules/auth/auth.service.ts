import {
  isClinicalDocumentIssuerProfile,
  isPhysicianProfile,
} from 'src/database/entities/doctor-profile.entity';
import {
  BadRequestException,
  ConflictException,
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
import { randomUUID } from 'crypto';

import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import { HttpMessages } from 'src/common';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';
import { RecoveryCodePurpose } from 'src/database/entities/recovery-code.entity';
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
import { SessionRevocationService } from './session-revocation.service';
import { normalizarEmail } from 'src/shared/validators/normalize-email.decorator';
import { canAdministrate, permissionsOf } from 'src/shared/permissions';
import { MfaService } from './mfa/mfa.service';
import { LoginMfaDto } from './mfa/dto/mfa.dto';
import {
  assertCodigoUtilizavel,
  codigoInvalido,
  codigosIguais,
  consumirTentativa,
} from './recovery-code-attempts.util';
import { AuthAttemptLimiter } from './auth-attempt-limiter';
import { TurnstileService } from './turnstile.service';
import { violouIndice } from 'src/database/repositories/unique-violation.util';
import { errorMessage } from 'src/shared/utils/error-message.util';
import {
  TELEFONE_INVALIDO_MENSAGEM,
  canonicalizarTelefone,
  variantesLegadasDoTelefone,
} from 'src/shared/utils/phone.util';

export const PHONE_ALREADY_IN_USE_MESSAGE =
  'Este telefone já está sendo utilizado por outra conta.';

const PHONE_UNIQUE_INDEX = 'IDX_users_phone_unique';

export const LOGIN_BLOQUEADO_MENSAGEM =
  'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.';

export const RECOVERY_BLOQUEADO_MENSAGEM =
  'Muitas tentativas com código inválido. Tente novamente mais tarde.';

function normalizePhone(phone: string): string {
  const canonico = canonicalizarTelefone(phone);
  if (!canonico) {
    throw new HttpException(TELEFONE_INVALIDO_MENSAGEM, HttpStatus.BAD_REQUEST);
  }
  return canonico;
}

function filtroPorTelefone(canonico: string): { phone: string }[] {
  return variantesLegadasDoTelefone(canonico).map((phone) => ({ phone }));
}

function isPhoneUniqueViolation(err: unknown): boolean {
  return violouIndice(err, PHONE_UNIQUE_INDEX);
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
    private readonly attemptLimiter: AuthAttemptLimiter,
    private readonly turnstileService: TurnstileService,
    private readonly sessionRevocation: SessionRevocationService,
    private readonly mfaService: MfaService,
  ) {}

  private hashFicticio: Promise<string> | null = null;

  private obterHashFicticio(): Promise<string> {
    if (!this.hashFicticio) {
      this.hashFicticio = bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
    }
    return this.hashFicticio;
  }

  private async falhaDeLogin(email: string): Promise<never> {
    await this.attemptLimiter.registerLoginFailure(email);
    throw new HttpException(HttpMessages.loginFailed, HttpStatus.BAD_REQUEST);
  }

  private readonly EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;
  private readonly RECOVERY_CODE_EXPIRY_MS = 15 * 60 * 1000;

  private async createRefreshToken(
    userId: string,
    familyId?: string | null,
  ): Promise<string> {
    return this.refreshTokenStore.issue(userId, familyId);
  }

  private signAccessToken(user: Pick<User, 'id' | 'tokenVersion'>): string {
    return this.jwtService.sign({
      userId: user.id,
      tv: user.tokenVersion ?? 0,
    });
  }

  async validateUser(rawEmail: string, password: string): Promise<User | null> {
    const email = normalizarEmail(rawEmail);
    if (await this.attemptLimiter.isLoginLocked(email)) {
      throw new HttpException(
        LOGIN_BLOQUEADO_MENSAGEM,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.userRepository.findOne(
      { email, status: UserStatus.ACTIVE },
      true,
    );

    if (!user || !password) {
      await bcrypt.compare(password ?? '', await this.obterHashFicticio());
      return this.falhaDeLogin(email);
    }

    if (!user.password) {
      throw new UnauthorizedException(
        'Conta sem senha definida. Acesse pelo link de primeiro acesso.',
      );
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return this.falhaDeLogin(email);
    }

    await this.attemptLimiter.clearLoginFailures(email);

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
  }

  async checkEmailAvailability(
    email: string,
  ): Promise<{ status: 'available' | 'pending_invite' | 'registered' }> {
    const existingUser = await this.userRepository.findOne({
      email: normalizarEmail(email),
    });

    if (!existingUser) return { status: 'available' };
    if (existingUser.status === UserStatus.PENDING) {
      return { status: 'pending_invite' };
    }
    return { status: 'registered' };
  }

  async checkPhoneAvailability(
    phone: string,
  ): Promise<{ status: 'available' | 'registered' }> {
    const existingUser = await this.userRepository.findOne(
      filtroPorTelefone(normalizePhone(phone)),
    );

    return { status: existingUser ? 'registered' : 'available' };
  }

  async register(data: RegisterDto, remoteIp?: string) {
    await this.turnstileService.assertHuman(data.captchaToken, remoteIp);

    const phoneDigits = await this.assertCadastroDisponivel(
      data.email,
      data.phone,
    );

    const user = await this.criarDonoDaConta(data, phoneDigits);
    await this.provisionarConta(user.id, data.planSlug);

    const doctorProfile = data.isDoctor
      ? await this.doctorProfileRepository.create({
          userId: user.id,
          crm: data.crm || '',
          crmState: data.crmState || '',
          specialty: data.specialty || null,
        })
      : null;

    void this.dispatchEmailVerification(user.id, user.name, user.email);

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
        permissions: permissionsOf({
          role: user.role,
          permissions: user.permissions,
          doctorProfile,
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

  private async assertCadastroDisponivel(
    email: string,
    phone: string,
  ): Promise<string> {
    const existingUser = await this.userRepository.findOne({
      email: normalizarEmail(email),
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

    const phoneDigits = normalizePhone(phone);
    const phoneOwner = await this.userRepository.findOne(
      filtroPorTelefone(phoneDigits),
    );
    if (phoneOwner) {
      throw new HttpException(
        PHONE_ALREADY_IN_USE_MESSAGE,
        HttpStatus.BAD_REQUEST,
      );
    }
    return phoneDigits;
  }

  private async criarDonoDaConta(
    data: RegisterDto,
    phoneDigits: string,
  ): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const userId = uuidv4();

    return this.userRepository
      .create({
        id: userId,
        name: data.name,
        email: normalizarEmail(data.email),
        password: hashedPassword,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        phone: phoneDigits,
        ownerId: userId,
      })
      .catch((err: unknown) => {
        if (isPhoneUniqueViolation(err)) {
          throw new HttpException(
            PHONE_ALREADY_IN_USE_MESSAGE,
            HttpStatus.BAD_REQUEST,
          );
        }
        throw err;
      });
  }

  private async provisionarConta(
    ownerId: string,
    planSlug?: string,
  ): Promise<void> {
    await Promise.all(
      DEFAULT_PROCEDURE_NAMES.map((name) =>
        this.procedureRepository.create({ name, ownerId }),
      ),
    );

    try {
      await this.subscriptionService.createInitialSubscription(
        ownerId,
        planSlug,
      );
    } catch (err) {
      this.logger.error(
        `Falha ao criar subscription para userId=${ownerId}: ${errorMessage(err)}`,
      );
    }
  }

  private enviarWhatsappDeBoasVindas(user: User): void {
    if (!user.phone) return;
    void this.whatsappService
      .sendUserWelcome(user.phone, user.name)
      .catch((err: unknown) => {
        this.logger.warn(
          `Falha ao enfileirar WhatsApp de boas-vindas para userId=${user.id}: ${errorMessage(err)}`,
        );
      });
  }

  async login(user: AuthDto) {
    const result = await this.validateUser(user.email, user.password);
    if (!result) return null;

    if (await this.mfaService.isEnabled(result.id)) {
      return {
        mfaRequired: true as const,
        mfaToken: this.mfaService.createLoginToken(result),
      };
    }

    return this.emitirSessao(result);
  }

  async loginWithMfa(data: LoginMfaDto) {
    const { userId, tv } = this.mfaService.verifyLoginToken(data.mfaToken);

    const user = await this.userRepository.findOne({
      id: userId,
      status: UserStatus.ACTIVE,
    });
    if (!user || !user.emailVerified || (user.tokenVersion ?? 0) !== tv) {
      throw new UnauthorizedException(
        'Sua verificação expirou. Entre com e-mail e senha novamente.',
      );
    }

    await this.mfaService.verifySecondFactor(userId, data.code, {
      allowRecovery: true,
    });

    return this.emitirSessao(user);
  }

  async issueSessionTokens(userId: string) {
    const user = await this.userRepository.findOne({
      id: userId,
      status: UserStatus.ACTIVE,
    });
    if (!user) throw new UnauthorizedException('Sessão inválida');
    return {
      access_token: this.signAccessToken(user),
      refresh_token: await this.createRefreshToken(user.id),
    };
  }

  private async emitirSessao(result: User) {
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
        permissions: permissionsOf({
          role: result.role,
          permissions: fullUser?.permissions,
          doctorProfile,
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
        createdAt: result.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: result.updatedAt?.toISOString() || new Date().toISOString(),
      },
      access_token: this.signAccessToken(result),
      refresh_token: refreshToken,
      pending_consents: pendingConsents,
    };
  }

  async me(userId: string) {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    const doctorProfile = user.doctorProfile ?? null;

    const [avatarUrl, signatureUrl, account, mfaEnabled] = await Promise.all([
      this.resolveStorageUrl(user.avatarUrl),
      this.resolveStorageUrl(doctorProfile?.signatureUrl),
      this.buildAccountInfo(user.id, user.ownerId),
      this.mfaService.isEnabled(user.id),
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
      permissions: permissionsOf({
        role: user.role,
        permissions: user.permissions,
        doctorProfile,
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
      mfaEnabled,
      mfaRecommended: !mfaEnabled && canAdministrate(user),
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
    const normalizedEmail = normalizarEmail(email);
    const user = await this.userRepository.findOne({ email: normalizedEmail });

    if (!user) {
      return { message: this.GENERIC_RECOVERY_MESSAGE };
    }

    if (user.status === UserStatus.PENDING) {
      this.logger.log(
        `[AUTH_RECOVERY] Recuperação ignorada para convite pendente userId=${user.id}`,
      );
      return { message: this.GENERIC_RECOVERY_MESSAGE };
    }

    if (
      (await this.attemptLimiter.isRecoveryValidationLocked(normalizedEmail)) ||
      !(await this.attemptLimiter.tryConsumeRecoveryIssue(user.id))
    ) {
      this.logger.warn(
        `[AUTH_RECOVERY] Limite de códigos por conta atingido para userId=${user.id}`,
      );
      return { message: this.GENERIC_RECOVERY_MESSAGE };
    }

    await this.recoveryCodeRepository.deleteMany({
      userId: user.id,
      used: false,
      purpose: RecoveryCodePurpose.PASSWORD_RESET,
    });

    const validationCode = generateValidationCode();

    await this.recoveryCodeRepository.create({
      userId: user.id,
      used: false,
      purpose: RecoveryCodePurpose.PASSWORD_RESET,
      code: validationCode,
      expiresAt: new Date(Date.now() + this.RECOVERY_CODE_EXPIRY_MS),
    });

    void this.mailService.sendPasswordRecovery(user.email, {
      userName: user.name,
      validationCode,
    });

    return { message: this.GENERIC_RECOVERY_MESSAGE };
  }

  private readonly RESET_TOKEN_EXPIRY_MS = 10 * 60 * 1000;

  async validateRecoveryPasswordCode(data: validationCodeDto) {
    const normalizedEmail = normalizarEmail(data.email);
    const normalizedCode = data.code.trim().replace(/\s+/g, '');

    if (await this.attemptLimiter.isRecoveryValidationLocked(normalizedEmail)) {
      throw new HttpException(
        RECOVERY_BLOQUEADO_MENSAGEM,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.userRepository.findOne({ email: normalizedEmail });
    if (!user) return this.falhaDeCodigo(normalizedEmail);

    const purpose =
      user.status === UserStatus.PENDING
        ? RecoveryCodePurpose.INVITE
        : RecoveryCodePurpose.PASSWORD_RESET;

    const registro = await this.recoveryCodeRepository.findActive(
      user.id,
      purpose,
    );

    try {
      assertCodigoUtilizavel(registro);
    } catch {
      return this.falhaDeCodigo(normalizedEmail);
    }

    const tentativaRegistrada = await consumirTentativa(
      this.recoveryCodeRepository,
      registro,
    );
    if (!tentativaRegistrada || !codigosIguais(registro.code, normalizedCode)) {
      return this.falhaDeCodigo(normalizedEmail);
    }

    const resetToken = uuidv4();
    const emitido = await this.recoveryCodeRepository.issueResetToken(
      registro.id,
      resetToken,
      new Date(Date.now() + this.RESET_TOKEN_EXPIRY_MS),
    );
    if (!emitido) throw codigoInvalido();

    return { message: 'Código validado com sucesso', resetToken };
  }

  private async falhaDeCodigo(email: string): Promise<never> {
    await this.attemptLimiter.registerRecoveryFailure(email);
    throw codigoInvalido();
  }

  private invalidResetTokenError(): BadRequestException {
    return new BadRequestException(
      'Token de redefinição inválido. Reinicie a recuperação de senha.',
    );
  }

  async changePassword(data: changePasswordDto) {
    const normalizedEmail = normalizarEmail(data.email);
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

    await this.sessionRevocation.revokeAllSessions(user.id, 'password_reset');

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

    await this.sessionRevocation.revokeAllSessions(user.id, 'password_changed');

    return { message: 'Senha alterada com sucesso' };
  }

  async refreshAccessToken(token: string) {
    const consumed = await this.refreshTokenStore.consume(token);

    if (consumed.status === 'reused') {
      this.logger.error(
        `[AUTH_REUSE_DETECTED] Reuso de refresh token detectado para userId=${consumed.userId} familyId=${consumed.familyId ?? 'legado'}. Revogando todas as sessões do usuário.`,
      );
      await this.sessionRevocation.revokeAllSessions(
        consumed.userId,
        'refresh_reuse',
      );
      throw new UnauthorizedException(
        'Sessão revogada por segurança. Faça login novamente.',
      );
    }

    if (consumed.status === 'grace_exhausted') {
      this.logger.warn(
        `[AUTH_REFRESH_GRACE_EXHAUSTED] Token já renovado reapresentado na janela de graça userId=${consumed.userId} familyId=${consumed.familyId ?? 'legado'}`,
      );
      throw new ConflictException(
        'Sessão já renovada em outra aba. Tente novamente.',
      );
    }

    if (consumed.status !== 'valid' && consumed.status !== 'grace') {
      throw new BadRequestException('Refresh token inválido');
    }

    const user = await this.userRepository.findOne({ id: consumed.userId });
    if (!user || user.status !== UserStatus.ACTIVE || !user.emailVerified) {
      await this.revokeRefreshTokens(consumed.userId);
      throw new UnauthorizedException(
        'Sessão inválida. Confirme seu e-mail e faça login novamente.',
      );
    }

    const newRefreshToken = await this.createRefreshToken(
      consumed.userId,
      consumed.familyId,
    );

    return {
      access_token: this.signAccessToken(user),
      refresh_token: newRefreshToken,
    };
  }

  async revokeRefreshTokens(userId: string) {
    await this.refreshTokenStore.revokeAllForUser(userId);
  }

  async logout(userId: string) {
    await this.sessionRevocation.revokeRefreshTokens(userId, 'logout');
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
      const verificationUrl = `${dashboardUrl}/confirmar-email#token=${token}`;

      await this.mailService.sendEmailVerification(email, {
        userName,
        email,
        verificationUrl,
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao enviar e-mail de verificação para userId=${userId}: ${errorMessage(err)}`,
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

    this.enviarWhatsappDeBoasVindas(user);

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
