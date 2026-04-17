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
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { SubscriptionPlan } from 'src/database/entities/subscription-plan.entity';
import { RefreshToken } from 'src/database/entities/refresh-token.entity';
import { HttpMessages } from 'src/common';
import { MailService } from 'src/shared/mail/mail.service';
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly userRepository: UserRepository,
    private readonly recoveryCodeRepository: RecoveryCodeRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly mailService: MailService,
    private jwtService: JwtService,
    @InjectRepository(SubscriptionPlan)
    private readonly subscriptionPlanRepo: Repository<SubscriptionPlan>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    private readonly configService: ConfigService,
  ) {}

  /** Refresh token expiry: 7 days */
  private readonly REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Generates a new refresh token, persists it, and returns it.
   */
  private async createRefreshToken(userId: string): Promise<string> {
    const token = uuidv4();
    await this.refreshTokenRepo.save({
      user_id: userId,
      token,
      expires_at: new Date(Date.now() + this.REFRESH_TOKEN_EXPIRY_MS),
    });
    return token;
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne(
      { email, status: UserStatus.ACTIVE },
      true,
    );

    if (user && password) {
      let isValid = await bcrypt.compare(password, user.password);

      if (isValid) return user;
      else
        throw new HttpException(
          HttpMessages.loginFailed,
          HttpStatus.BAD_REQUEST,
        );
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

    // Buscar plano selecionado ou usar Básico como padrão
    let selectedPlan = null;
    if (data.subscription_plan_id) {
      selectedPlan = await this.subscriptionPlanRepo.findOne({
        where: { id: data.subscription_plan_id, is_active: true },
      });
    }
    if (!selectedPlan) {
      selectedPlan = await this.subscriptionPlanRepo.findOne({
        where: { name: 'Básico', is_active: true },
      });
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(data.password, 10);

    const isDoctor = data.is_doctor || false;

    // Gera o UUID antes para usar como id E account_id (self-referência)
    const userId = uuidv4();

    // Cria o usuário como Admin com account_id = self.id na mesma operação
    const user = await this.userRepository.create({
      id: userId,
      name: data.name,
      email: data.email,
      password: hashedPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      phone: null,
      account_id: userId, // self-referência — mesmo ID
      subscription_plan_id: selectedPlan?.id || null,
    } as Partial<User>);

    // Se é médico, criar doctor_profile
    let doctorProfile = null;
    if (isDoctor) {
      doctorProfile = await this.doctorProfileRepository.create({
        user_id: user.id,
        crm: data.crm || '',
        crm_state: data.crm_state || '',
        specialty: data.specialty || null,
      });
    }

    // Retorna dados do usuário e tokens
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
        account_id: user.account_id,
        is_doctor: !!doctorProfile,
        doctor_profile: doctorProfile
          ? {
              id: doctorProfile.id,
              crm: doctorProfile.crm,
              crm_state: doctorProfile.crm_state,
              specialty: doctorProfile.specialty,
              signature_url: doctorProfile.signature_url,
              clinic_name: doctorProfile.clinic_name,
            }
          : null,
        createdAt: user.created_at?.toISOString() || new Date().toISOString(),
        updatedAt: user.updated_at?.toISOString() || new Date().toISOString(),
      },
      access_token: this.jwtService.sign({ userId: user.id }),
      refresh_token: refreshToken,
    };
  }

  async login(user: AuthDto) {
    const result = await this.validateUser(user.email, user.password);

    if (result) {
      // Buscar doctor_profile para o response
      const doctorProfile = await this.doctorProfileRepository.findByUserId(
        result.id,
      );
      // Buscar user com account_id
      const fullUser = await this.userRepository.findOne({ id: result.id });

      const refreshToken = await this.createRefreshToken(result.id);

      return {
        user: {
          id: result.id.toString(),
          role: result.role,
          name: result.name,
          phone: result.phone,
          email: result.email,
          cpf: result.cpf,
          status: result.status,
          account_id: fullUser?.account_id,
          is_doctor: !!doctorProfile,
          doctor_profile: doctorProfile
            ? {
                id: doctorProfile.id,
                crm: doctorProfile.crm,
                crm_state: doctorProfile.crm_state,
                specialty: doctorProfile.specialty,
                signature_url: doctorProfile.signature_url,
                clinic_name: doctorProfile.clinic_name,
              }
            : null,
          createdAt:
            result.created_at?.toISOString() || new Date().toISOString(),
          updatedAt:
            result.updated_at?.toISOString() || new Date().toISOString(),
        },
        access_token: this.jwtService.sign({ userId: result.id }),
        refresh_token: refreshToken,
      };
    }
  }

  async me(userId: string) {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    const doctorProfile = user?.doctor_profile || null;

    return {
      id: user.id,
      role: user.role,
      name: user.name,
      phone: user.phone,
      email: user.email,
      account_id: user.account_id,
      avatar_url: user.avatar_url ?? null,
      is_doctor: !!doctorProfile,
      doctor_profile: doctorProfile
        ? {
            id: doctorProfile.id,
            crm: doctorProfile.crm,
            crm_state: doctorProfile.crm_state,
            specialty: doctorProfile.specialty,
            signature_url: doctorProfile.signature_url,
            clinic_name: doctorProfile.clinic_name,
          }
        : null,
    };
  }

  async sendRecoveryPasswordEmail(email: string) {
    const user = await this.userRepository.findOne({ email });

    if (!user) throw new NotFoundException('User not found');

    // Remove any existing unused recovery codes for this user
    await this.recoveryCodeRepository.deleteMany({
      user_id: user.id,
      used: false,
    });

    const validationCode = generateValidationCode();

    await this.recoveryCodeRepository.create({
      user_id: user.id,
      used: false,
      code: validationCode,
      expires_at: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    });

    this.mailService.sendRaw(
      user.email,
      'Inexci - Recuperação de senha',
      `
      <p>Olá, <strong>${user.name}</strong></p>
      <p>Você solicitou a recuperação de senha. Para continuar, utilize o código abaixo:</p>
      <p><strong>${validationCode}</strong></p>
      <p>Se você não solicitou a recuperação de senha, por favor, ignore este e-mail.</p>
      `,
    );

    return { message: 'E-mail enviado com sucesso' };
  }

  async validateRecoveryPasswordCode(data: validationCodeDto) {
    const validationCode = await this.recoveryCodeRepository.findOne({
      code: data.code,
      used: false,
    });

    if (!validationCode) throw new NotFoundException('Código inválido');

    if (
      validationCode.expires_at &&
      new Date() > new Date(validationCode.expires_at)
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
      user_id: user.id,
      used: true,
    });

    if (!validatedCode) {
      throw new BadRequestException(
        'Nenhum código de recuperação validado encontrado',
      );
    }

    const password = await bcrypt.hash(data.password, 10);

    await this.userRepository.update(user.id, { password: password });

    // Invalidate all recovery codes for this user after successful password change
    await this.recoveryCodeRepository.deleteMany({ user_id: user.id });

    return { message: 'Senha alterada com sucesso' };
  }

  async getAvailablePlans() {
    const plans = await this.subscriptionPlanRepo.find({
      where: { is_active: true },
      order: { max_doctors: 'ASC' },
      select: ['id', 'name', 'description', 'max_doctors'],
    });
    return plans;
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

    if (new Date() > new Date(storedToken.expires_at)) {
      // Revoke expired token
      await this.refreshTokenRepo.update(storedToken.id, { revoked: true });
      throw new BadRequestException('Refresh token expirado');
    }

    // Revoke the used token (rotation)
    await this.refreshTokenRepo.update(storedToken.id, { revoked: true });

    // Issue new tokens
    const newRefreshToken = await this.createRefreshToken(storedToken.user_id);

    return {
      access_token: this.jwtService.sign({ userId: storedToken.user_id }),
      refresh_token: newRefreshToken,
    };
  }

  /**
   * Revokes all refresh tokens for a user (used on logout or password change).
   */
  async revokeRefreshTokens(userId: string) {
    await this.refreshTokenRepo.update(
      { user_id: userId, revoked: false },
      { revoked: true },
    );
  }
}
