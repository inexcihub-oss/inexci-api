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
import { SubscriptionService } from '../billing/services/subscription.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { LogTrace } from 'src/shared/logging/trace.decorator';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { DEFAULT_PROCEDURE_NAMES } from '../procedures/default-procedures.constants';
import { RefreshTokenStore } from './refresh-token.store';

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

  /** Email verification token expiry: 24 hours */
  private readonly EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

  /**
   * Generates a new refresh token (persisted as hash in Redis) and returns the
   * raw value to be sent to the client via httpOnly cookie.
   */
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

      return user;
    } else {
      throw new HttpException(HttpMessages.loginFailed, HttpStatus.BAD_REQUEST);
    }
  }

  async register(data: RegisterDto) {
    // Verifica se o email já existe
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

    // Hash da senha
    const hashedPassword = await bcrypt.hash(data.password, 10);

    const isDoctor = data.isDoctor || false;

    // Gera o UUID antes para usar como id E ownerId (self-referência)
    const userId = uuidv4();

    // Cria o usuário como Admin com ownerId = self.id na mesma operação
    const user = await this.userRepository.create({
      id: userId,
      name: data.name,
      email: data.email,
      password: hashedPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      phone: data.phone.replace(/\D/g, ''),
      ownerId: userId, // self-referência — mesmo ID
    } as Partial<User>);

    await Promise.all(
      DEFAULT_PROCEDURE_NAMES.map((name) =>
        this.procedureRepository.create({ name, ownerId: user.id }),
      ),
    );

    // Cria automaticamente uma assinatura inicial (trial ou paga conforme o plano)
    const paymentInfo = data.paymentMethodId
      ? {
          paymentMethodId: data.paymentMethodId,
          brand: data.cardBrand ?? '',
          last4: data.cardLast4 ?? '',
          holderName: data.cardHolderName ?? '',
          expMonth: data.cardExpMonth ?? 1,
          expYear: data.cardExpYear ?? new Date().getFullYear(),
        }
      : undefined;

    try {
      await this.subscriptionService.createInitialSubscription(
        user.id,
        data.planSlug,
        paymentInfo,
      );
    } catch (err) {
      if (paymentInfo) {
        await this.userRepository.delete(user.id).catch(() => {});
        throw err;
      }
      this.logger.error(
        `Falha ao criar subscription para userId=${user.id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Se é médico, criar doctorProfile
    let doctorProfile = null;
    if (isDoctor) {
      doctorProfile = await this.doctorProfileRepository.create({
        userId: user.id,
        crm: data.crm || '',
        crmState: data.crmState || '',
        specialty: data.specialty || null,
      });
    }

    // Envia e-mail de confirmação (não bloqueia caso falhe)
    void this.dispatchEmailVerification(user.id, user.name, user.email);

    // Envia WhatsApp de boas-vindas (não bloqueia caso falhe)
    if (user.phone) {
      void this.whatsappService
        .sendUserWelcome(user.phone, user.name)
        .catch((err) => {
          this.logger.warn(
            `Falha ao enfileirar WhatsApp de boas-vindas para userId=${user.id}: ${err?.message ?? err}`,
          );
        });
    }

    // O cadastro NÃO inicia sessão: o usuário precisa confirmar o e-mail antes de
    // logar. Não geramos access/refresh token aqui para evitar persistir um
    // refresh token órfão em `refresh_tokens` (o controller já não os utiliza).
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
        emailVerified: user.emailVerified ?? false,
        doctorProfile: doctorProfile
          ? {
              id: doctorProfile.id,
              crm: doctorProfile.crm,
              crmState: doctorProfile.crmState,
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
      // Buscar doctorProfile para o response
      const doctorProfile = await this.doctorProfileRepository.findByUserId(
        result.id,
      );
      // Buscar user com ownerId
      const fullUser = await this.userRepository.findOne({ id: result.id });

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
          isDoctor: !!doctorProfile,
          emailVerified: fullUser?.emailVerified ?? false,
          doctorProfile: doctorProfile
            ? {
                id: doctorProfile.id,
                crm: doctorProfile.crm,
                crmState: doctorProfile.crmState,
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

    const [avatarUrl, signatureUrl] = await Promise.all([
      this.resolveStorageUrl(user.avatarUrl),
      this.resolveStorageUrl(doctorProfile?.signatureUrl),
    ]);

    return {
      id: user.id,
      role: user.role,
      name: user.name,
      phone: user.phone,
      email: user.email,
      ownerId: user.ownerId,
      avatarUrl,
      isDoctor: !!doctorProfile,
      emailVerified: user.emailVerified ?? false,
      doctorProfile: doctorProfile
        ? {
            id: doctorProfile.id,
            crm: doctorProfile.crm,
            crmState: doctorProfile.crmState,
            specialty: doctorProfile.specialty,
            signatureUrl,
            clinicName: doctorProfile.clinicName,
          }
        : null,
    };
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

  /**
   * Mensagem genérica de recuperação. **Não** revela se o e-mail existe
   * (anti-enumeration): tanto sucesso quanto e-mail inexistente retornam isto.
   */
  private readonly GENERIC_RECOVERY_MESSAGE =
    'Se o e-mail existir, enviaremos um código de recuperação.';

  async sendRecoveryPasswordEmail(email: string) {
    const normalizedEmail = email.trim();
    const user = await this.userRepository.findOne({ email: normalizedEmail });

    // Anti-enumeration: para um e-mail inexistente, retorna a MESMA resposta do
    // caso de sucesso (sem lançar, sem enfileirar e-mail). Assim não dá para
    // distinguir e-mails cadastrados por status/corpo. O throttle (3/h) já
    // protege contra varredura por latência.
    if (!user) {
      return { message: this.GENERIC_RECOVERY_MESSAGE };
    }

    // Remove any existing unused recovery codes for this user
    await this.recoveryCodeRepository.deleteMany({
      userId: user.id,
      used: false,
    });

    const validationCode = generateValidationCode();

    await this.recoveryCodeRepository.create({
      userId: user.id,
      used: false,
      code: validationCode,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    });

    void this.mailService.sendPasswordRecovery(user.email, {
      userName: user.name,
      validationCode,
    });

    return { message: this.GENERIC_RECOVERY_MESSAGE };
  }

  /** TTL do reset token de uso único: 10 minutos. */
  private readonly RESET_TOKEN_EXPIRY_MS = 10 * 60 * 1000;

  async validateRecoveryPasswordCode(data: validationCodeDto) {
    const normalizedEmail = data.email.trim();
    const normalizedCode = data.code.trim().replace(/\s+/g, '');

    // Escopa a validação ao usuário (via e-mail): um código não pode ser
    // validado fora da conta dona dele.
    const user = await this.userRepository.findOne({ email: normalizedEmail });
    if (!user) throw new NotFoundException('Código inválido');

    const validationCode = await this.recoveryCodeRepository.findOne({
      userId: user.id,
      code: normalizedCode,
      used: false,
    });

    if (!validationCode) throw new NotFoundException('Código inválido');

    if (
      validationCode.expiresAt &&
      new Date() > new Date(validationCode.expiresAt)
    ) {
      throw new BadRequestException('Código expirado');
    }

    // Marca o código como usado e emite um reset token de uso único e curta
    // duração, exigido no changePassword.
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

  async changePassword(data: changePasswordDto) {
    const normalizedEmail = data.email.trim();
    const normalizedResetToken = data.resetToken.trim();

    const user = await this.userRepository.findOne({ email: normalizedEmail });

    if (!user) throw new NotFoundException('User not found');

    // Exige o reset token de uso único emitido na validação do código, escopado
    // ao usuário. Sem isso, qualquer código "usado" da conta liberaria a troca.
    const validatedCode = await this.recoveryCodeRepository.findOne({
      userId: user.id,
      resetToken: normalizedResetToken,
      used: true,
    });

    if (!validatedCode) {
      throw new BadRequestException(
        'Token de redefinição inválido. Reinicie a recuperação de senha.',
      );
    }

    if (
      !validatedCode.resetTokenExpiresAt ||
      new Date() > new Date(validatedCode.resetTokenExpiresAt)
    ) {
      throw new BadRequestException(
        'Token de redefinição expirado. Reinicie a recuperação de senha.',
      );
    }

    const password = await bcrypt.hash(data.password, 10);

    // Atualiza senha e ativa conta caso ainda esteja pendente (primeiro acesso).
    // Marca e-mail como verificado: o link do convite já prova a posse do endereço.
    const now = new Date();
    const updatePayload: Partial<User> = { password };
    if (user.status === UserStatus.PENDING) {
      updatePayload.status = UserStatus.ACTIVE;
      updatePayload.emailVerified = true;
      updatePayload.emailVerifiedAt = now;
    }

    await this.userRepository.update(user.id, updatePayload);

    // Invalidate all recovery codes for this user after successful password change
    await this.recoveryCodeRepository.deleteMany({ userId: user.id });

    return { message: 'Senha alterada com sucesso' };
  }

  async changePasswordAuthenticated(
    data: ChangePasswordAuthenticatedDto,
    userId: string,
  ) {
    const user = await this.userRepository.findOne({ id: userId }, true);

    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Verifica se a senha atual está correta
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

    // Hash da nova senha
    const newPasswordHash = await bcrypt.hash(data.newPassword, 10);

    await this.userRepository.update(user.id, { password: newPasswordHash });

    return { message: 'Senha alterada com sucesso' };
  }

  /**
   * Validates a refresh token and returns a new access_token + rotated refresh_token.
   *
   * O consumo é atômico no Redis (marca o token usado como revogado). Reações:
   *  - `not_found` (inexistente/expirado): "Refresh token inválido".
   *  - `reused` (token conhecido, já rotacionado e fora da janela de graça):
   *    sinal de roubo → revoga **toda** a família de refresh tokens do usuário e
   *    força novo login. Corridas legítimas são absorvidas pela janela de graça
   *    do store (Fase 6b), então `reused` aqui é genuíno.
   *  - `valid` (inclui reuso dentro da janela de graça): rotaciona normalmente.
   */
  async refreshAccessToken(token: string) {
    const consumed = await this.refreshTokenStore.consume(token);

    if (consumed.status === 'reused') {
      this.logger.warn(
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

    // Revalida o usuário: um refresh token não pode reanimar uma sessão de uma
    // conta inativa ou com e-mail ainda não confirmado (mesma barreira do login).
    // Sem isso, um refresh token antigo furaria a verificação de e-mail.
    const user = await this.userRepository.findOne({ id: consumed.userId });
    if (!user || user.status !== UserStatus.ACTIVE || !user.emailVerified) {
      await this.revokeRefreshTokens(consumed.userId);
      throw new UnauthorizedException(
        'Sessão inválida. Confirme seu e-mail e faça login novamente.',
      );
    }

    // Emite o novo refresh token (o anterior já foi revogado no consume).
    const newRefreshToken = await this.createRefreshToken(consumed.userId);

    return {
      access_token: this.jwtService.sign({ userId: consumed.userId }),
      refresh_token: newRefreshToken,
    };
  }

  /**
   * Revokes all refresh tokens for a user (used on logout or password change).
   */
  async revokeRefreshTokens(userId: string) {
    await this.refreshTokenStore.revokeAllForUser(userId);
  }

  /**
   * Cria token de verificação, persiste e envia e-mail de confirmação.
   * Falhas no envio são apenas logadas — não interrompem o fluxo do chamador.
   */
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

  /**
   * Confirma o e-mail de um usuário a partir do token enviado por e-mail.
   */
  async verifyEmail(token: string) {
    if (!token) {
      throw new BadRequestException('Token de verificação inválido');
    }

    const user = await this.userRepository.findOne({
      emailVerificationToken: token,
    });

    if (!user) {
      // Token não encontrado — pode já ter sido consumido ou nunca existiu.
      // Verifica se algum usuário verificado possui esse token nulo (clique duplo)
      throw new BadRequestException('Token de verificação inválido');
    }

    // Se o usuário já está verificado mas o token ainda está na coluna (clique duplo / StrictMode)
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

  /**
   * Reenvia o e-mail de confirmação para o usuário autenticado.
   */
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
