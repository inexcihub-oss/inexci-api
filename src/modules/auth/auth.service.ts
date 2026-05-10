import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import { RefreshToken } from 'src/database/entities/refresh-token.entity';
import { HttpMessages } from 'src/common';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthDto } from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';
import { validationCodeDto } from './dto/validation-code.dto';
import { changePasswordDto } from './dto/change-password.dto';
import { ChangePasswordAuthenticatedDto } from './dto/change-password-authenticated.dto';
import { generateValidationCode } from 'src/shared/utils';
import { ConsentService } from '../privacy/consent.service';
import { SubscriptionService } from '../billing/services/subscription.service';
import { LogTrace } from 'src/shared/logging/trace.decorator';

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
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    private readonly configService: ConfigService,
    private readonly consentService: ConsentService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /** Email verification token expiry: 24 hours */
  private readonly EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

  /** Refresh token expiry: 7 days */
  private readonly REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Generates a new refresh token, persists it, and returns it.
   */
  private async createRefreshToken(userId: string): Promise<string> {
    const token = uuidv4();
    await this.refreshTokenRepo.save({
      userId: userId,
      token,
      expiresAt: new Date(Date.now() + this.REFRESH_TOKEN_EXPIRY_MS),
    });
    return token;
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne(
      { email, status: UserStatus.ACTIVE },
      true,
    );

    if (user && password) {
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

    // Cria automaticamente uma assinatura TRIALING de 30 dias, ancorada no
    // plano escolhido pelo usuário no cadastro (ou no plano default se não
    // foi informado). Trial não exige cartão.
    try {
      await this.subscriptionService.createTrialSubscription(
        user.id,
        data.planSlug,
      );
    } catch (err) {
      this.logger.error(
        `Falha ao criar trial para userId=${user.id}: ${err instanceof Error ? err.message : err}`,
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

    const refreshToken = await this.createRefreshToken(user.id);

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
      access_token: this.jwtService.sign({ userId: user.id }),
      refresh_token: refreshToken,
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
      } catch {
        // Não bloqueia login se a verificação de consentimento falhar
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
  }

  async me(userId: string) {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    const doctorProfile = user?.doctorProfile || null;

    return {
      id: user.id,
      role: user.role,
      name: user.name,
      phone: user.phone,
      email: user.email,
      ownerId: user.ownerId,
      avatarUrl: user.avatarUrl ?? null,
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
    };
  }

  async sendRecoveryPasswordEmail(email: string) {
    const user = await this.userRepository.findOne({ email });

    if (!user) throw new NotFoundException('User not found');

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

    return { message: 'E-mail enviado com sucesso' };
  }

  async validateRecoveryPasswordCode(data: validationCodeDto) {
    const validationCode = await this.recoveryCodeRepository.findOne({
      code: data.code,
      used: false,
    });

    if (!validationCode) throw new NotFoundException('Código inválido');

    if (
      validationCode.expiresAt &&
      new Date() > new Date(validationCode.expiresAt)
    ) {
      throw new BadRequestException('Código expirado');
    }

    await this.recoveryCodeRepository.updateByWhere(
      { id: validationCode.id },
      { used: true },
    );

    return { message: 'Código validado com sucesso' };
  }

  async changePassword(data: changePasswordDto) {
    const user = await this.userRepository.findOne({ email: data.email });

    if (!user) throw new NotFoundException('User not found');

    // Verify that a recovery code was recently validated for this user
    const validatedCode = await this.recoveryCodeRepository.findOne({
      userId: user.id,
      used: true,
    });

    if (!validatedCode) {
      throw new BadRequestException(
        'Nenhum código de recuperação validado encontrado',
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
   */
  async refreshAccessToken(token: string) {
    const storedToken = await this.refreshTokenRepo.findOne({
      where: { token, revoked: false },
    });

    if (!storedToken) {
      throw new BadRequestException('Refresh token inválido');
    }

    if (new Date() > new Date(storedToken.expiresAt)) {
      // Revoke expired token
      await this.refreshTokenRepo.update(storedToken.id, { revoked: true });
      throw new BadRequestException('Refresh token expirado');
    }

    // Revoke the used token (rotation)
    await this.refreshTokenRepo.update(storedToken.id, { revoked: true });

    // Issue new tokens
    const newRefreshToken = await this.createRefreshToken(storedToken.userId);

    return {
      access_token: this.jwtService.sign({ userId: storedToken.userId }),
      refresh_token: newRefreshToken,
    };
  }

  /**
   * Revokes all refresh tokens for a user (used on logout or password change).
   */
  async revokeRefreshTokens(userId: string) {
    await this.refreshTokenRepo.update(
      { userId: userId, revoked: false },
      { revoked: true },
    );
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
