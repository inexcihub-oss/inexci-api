import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from 'src/database/entities/user.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import {
  buildOtpauthUri,
  generateTotpSecret,
  isTotpFormat,
  verifyTotp,
} from 'src/shared/crypto/totp.util';
import { AuthAttemptLimiter } from '../auth-attempt-limiter';
import { SessionRevocationService } from '../session-revocation.service';
import {
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
} from '../jwt-payload.interface';
import {
  deriveRecoveryPepper,
  findRecoveryCodeHash,
  generateRecoveryCodes,
  hashRecoveryCode,
  isRecoveryCodeFormat,
} from './mfa-recovery-codes.util';

export const MFA_ISSUER = 'INEXCI';
export const MFA_TOKEN_PURPOSE = 'mfa';
export const MFA_TOKEN_TTL = '5m';
export const MFA_AUDIENCE_SUFFIX = ':mfa';

export const MFA_CODIGO_INVALIDO = 'Código de verificação inválido.';
export const MFA_BLOQUEADO =
  'Muitas tentativas com código inválido. Aguarde alguns minutos e tente novamente.';
export const MFA_TOKEN_INVALIDO =
  'Sua verificação expirou. Entre com e-mail e senha novamente.';

export interface MfaLoginTokenPayload {
  userId: string;
  tv: number;
  purpose: typeof MFA_TOKEN_PURPOSE;
}

export interface MfaSetupResult {
  secret: string;
  formattedSecret: string;
  otpauthUri: string;
}

type MetodoVerificacao = 'totp' | 'recovery';

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private pepper: Buffer | null = null;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly attemptLimiter: AuthAttemptLimiter,
    private readonly sessionRevocation: SessionRevocationService,
  ) {}

  private recoveryPepper(): Buffer {
    if (!this.pepper) {
      const segredo = this.configService.get<string>('JWT_SECRET');
      if (!segredo) {
        throw new Error('JWT_SECRET environment variable is required');
      }
      this.pepper = deriveRecoveryPepper(segredo);
    }
    return this.pepper;
  }

  private issuer(): string {
    return this.configService.get<string>('JWT_ISSUER', JWT_DEFAULT_ISSUER);
  }

  private mfaAudience(): string {
    const base = this.configService.get<string>(
      'JWT_AUDIENCE',
      JWT_DEFAULT_AUDIENCE,
    );
    return `${base}${MFA_AUDIENCE_SUFFIX}`;
  }

  isEnabled(userId: string): Promise<boolean> {
    return this.userRepository.isMfaEnabled(userId);
  }

  createLoginToken(user: Pick<User, 'id' | 'tokenVersion'>): string {
    const payload: MfaLoginTokenPayload = {
      userId: user.id,
      tv: user.tokenVersion ?? 0,
      purpose: MFA_TOKEN_PURPOSE,
    };
    return this.jwtService.sign(payload, {
      audience: this.mfaAudience(),
      issuer: this.issuer(),
      expiresIn: MFA_TOKEN_TTL,
    });
  }

  verifyLoginToken(token: string): { userId: string; tv: number } {
    let payload: Partial<MfaLoginTokenPayload>;
    try {
      payload = this.jwtService.verify<MfaLoginTokenPayload>(token, {
        audience: this.mfaAudience(),
        issuer: this.issuer(),
      });
    } catch {
      throw new UnauthorizedException(MFA_TOKEN_INVALIDO);
    }
    if (
      payload?.purpose !== MFA_TOKEN_PURPOSE ||
      typeof payload.userId !== 'string'
    ) {
      throw new UnauthorizedException(MFA_TOKEN_INVALIDO);
    }
    return { userId: payload.userId, tv: payload.tv ?? 0 };
  }

  async setup(userId: string): Promise<MfaSetupResult> {
    const user = await this.carregar(userId);
    if (user.mfaEnabledAt) {
      throw new ConflictException(
        'A verificação em duas etapas já está ativa.',
      );
    }
    const secret = generateTotpSecret();
    await this.userRepository.savePendingMfaSecret(userId, secret);
    return {
      secret,
      formattedSecret: secret.match(/.{1,4}/g)?.join(' ') ?? secret,
      otpauthUri: buildOtpauthUri(secret, user.email, MFA_ISSUER),
    };
  }

  async enable(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    await this.assertNaoBloqueado(userId);
    const user = await this.carregar(userId);
    if (user.mfaEnabledAt) {
      throw new ConflictException(
        'A verificação em duas etapas já está ativa.',
      );
    }
    if (!user.mfaPendingSecret) {
      throw new BadRequestException(
        'Inicie a configuração da verificação em duas etapas novamente.',
      );
    }

    const step = verifyTotp(user.mfaPendingSecret, code);
    if (step === null) {
      return this.falha(userId);
    }

    const recoveryCodes = generateRecoveryCodes();
    const ativado = await this.userRepository.enableMfa(userId, {
      secret: user.mfaPendingSecret,
      recoveryCodeHashes: this.hashes(recoveryCodes),
      usedStep: step,
    });
    if (!ativado) {
      throw new ConflictException(
        'A verificação em duas etapas já está ativa.',
      );
    }
    await this.attemptLimiter.clearMfaFailures(userId);
    this.logger.log(`[AUTH_MFA_ENABLED] userId=${userId}`);
    return { recoveryCodes };
  }

  async verifySecondFactor(
    userId: string,
    code: string,
    options: { allowRecovery: boolean },
  ): Promise<MetodoVerificacao> {
    await this.assertNaoBloqueado(userId);
    const user = await this.carregar(userId);
    if (!user.mfaEnabledAt || !user.mfaSecret) {
      throw new BadRequestException(
        'A verificação em duas etapas não está ativa.',
      );
    }

    if (isTotpFormat(code)) {
      const step = verifyTotp(user.mfaSecret, code);
      if (
        step !== null &&
        (await this.userRepository.consumeMfaStep(userId, step))
      ) {
        await this.attemptLimiter.clearMfaFailures(userId);
        return 'totp';
      }
      return this.falha(userId);
    }

    if (options.allowRecovery && isRecoveryCodeFormat(code)) {
      const hash = findRecoveryCodeHash(
        user.mfaRecoveryCodes,
        hashRecoveryCode(code, this.recoveryPepper()),
      );
      if (
        hash &&
        (await this.userRepository.consumeMfaRecoveryCode(userId, hash))
      ) {
        await this.attemptLimiter.clearMfaFailures(userId);
        this.logger.log(`[AUTH_MFA_RECOVERY_USED] userId=${userId}`);
        return 'recovery';
      }
    }

    return this.falha(userId);
  }

  async disable(userId: string, password: string, code: string) {
    await this.assertNaoBloqueado(userId);
    const comSenha = await this.userRepository.findOne({ id: userId }, true);
    if (!comSenha?.password) {
      throw new BadRequestException('Senha atual incorreta');
    }
    const senhaValida = await bcrypt.compare(password, comSenha.password);
    if (!senhaValida) {
      await this.attemptLimiter.registerMfaFailure(userId);
      throw new BadRequestException('Senha atual incorreta');
    }

    await this.verifySecondFactor(userId, code, { allowRecovery: true });
    await this.userRepository.disableMfa(userId);
    await this.sessionRevocation.revokeAllSessions(userId, 'mfa_disabled');
    this.logger.log(`[AUTH_MFA_DISABLED] userId=${userId}`);
    return { message: 'Verificação em duas etapas desativada.' };
  }

  async regenerateRecoveryCodes(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    await this.verifySecondFactor(userId, code, { allowRecovery: false });
    const recoveryCodes = generateRecoveryCodes();
    const salvo = await this.userRepository.replaceMfaRecoveryCodes(
      userId,
      this.hashes(recoveryCodes),
    );
    if (!salvo) {
      throw new BadRequestException(
        'A verificação em duas etapas não está ativa.',
      );
    }
    this.logger.log(`[AUTH_MFA_RECOVERY_REGENERATED] userId=${userId}`);
    return { recoveryCodes };
  }

  private hashes(codigos: string[]): string[] {
    const pepper = this.recoveryPepper();
    return codigos.map((c) => hashRecoveryCode(c, pepper));
  }

  private async carregar(userId: string): Promise<User> {
    const user = await this.userRepository.findMfaState(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }

  private async assertNaoBloqueado(userId: string): Promise<void> {
    if (await this.attemptLimiter.isMfaLocked(userId)) {
      throw new HttpException(MFA_BLOQUEADO, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async falha(userId: string): Promise<never> {
    const bloqueou = await this.attemptLimiter.registerMfaFailure(userId);
    if (bloqueou) {
      this.logger.warn(`[AUTH_MFA_LOCKED] userId=${userId}`);
      throw new HttpException(MFA_BLOQUEADO, HttpStatus.TOO_MANY_REQUESTS);
    }
    throw new BadRequestException(MFA_CODIGO_INVALIDO);
  }
}
