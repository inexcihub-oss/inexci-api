import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import {
  PlatformAdmin,
  PlatformAdminStatus,
} from 'src/database/entities/platform-admin.entity';
import { PlatformAdminRepository } from 'src/database/repositories/platform-admin.repository';
import { AuthAttemptLimiter } from 'src/modules/auth/auth-attempt-limiter';
import { LOGIN_BLOQUEADO_MENSAGEM } from 'src/modules/auth/auth.service';
import {
  MFA_BLOQUEADO,
  MFA_CODIGO_INVALIDO,
} from 'src/modules/auth/mfa/mfa.service';
import {
  deriveRecoveryPepper,
  findRecoveryCodeHash,
  generateRecoveryCodes,
  hashRecoveryCode,
  isRecoveryCodeFormat,
} from 'src/modules/auth/mfa/mfa-recovery-codes.util';
import { BCRYPT_ROUNDS } from 'src/shared/constants/bcrypt';
import {
  buildOtpauthUri,
  generateTotpSecret,
  isTotpFormat,
  verifyTotp,
} from 'src/shared/crypto/totp.util';
import { errorMessage } from 'src/shared/utils/error-message.util';
import { AdminRefreshTokenStore } from './admin-refresh-token.store';
import {
  ADMIN_ETAPA_EXPIRADA,
  ADMIN_SESSAO_INVALIDA,
  AdminStepPurpose,
  AdminTokenService,
} from './admin-token.service';
import { inviteTokenConfere } from './admin-invite.util';

export const ADMIN_CREDENCIAIS_INVALIDAS = 'E-mail ou senha inválidos.';
export const ADMIN_CONVITE_INVALIDO = 'Convite inválido ou expirado.';
export const ADMIN_MFA_ISSUER = 'Inexci Admin';
export const ADMIN_MFA_JA_ATIVO = 'A verificação em duas etapas já está ativa.';

const CHAVE_LIMITE = 'admin:';

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  mfaEnabled: boolean;
}

export type AdminLoginStep =
  | { step: 'mfa'; mfaToken: string }
  | { step: 'mfa_setup'; setupToken: string };

export interface AdminSession {
  accessToken: string;
  refreshToken: string;
  admin: AdminProfile;
}

export function adminProfile(
  admin: Pick<PlatformAdmin, 'id' | 'name' | 'email' | 'mfaEnabledAt'>,
): AdminProfile {
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    mfaEnabled: !!admin.mfaEnabledAt,
  };
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private hashFicticio: Promise<string> | null = null;
  private pepper: Buffer | null = null;

  constructor(
    private readonly admins: PlatformAdminRepository,
    private readonly tokens: AdminTokenService,
    private readonly refreshStore: AdminRefreshTokenStore,
    private readonly limiter: AuthAttemptLimiter,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<AdminLoginStep> {
    const chave = `${CHAVE_LIMITE}${email}`;
    if (await this.limiter.isLoginLocked(chave)) {
      throw new HttpException(
        LOGIN_BLOQUEADO_MENSAGEM,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const admin = await this.admins.findForLogin(email);
    const hash = admin?.passwordHash ?? (await this.obterHashFicticio());
    const senhaConfere = await bcrypt.compare(password ?? '', hash);

    if (
      !admin ||
      !admin.passwordHash ||
      !senhaConfere ||
      admin.status !== PlatformAdminStatus.ACTIVE
    ) {
      await this.limiter.registerLoginFailure(chave);
      this.logger.warn(
        `[ADMIN_LOGIN_FAILED] adminId=${admin?.id ?? 'desconhecido'}`,
      );
      throw new UnauthorizedException({ message: ADMIN_CREDENCIAIS_INVALIDAS });
    }

    await this.limiter.clearLoginFailures(chave);

    if (admin.mfaEnabledAt) {
      return { step: 'mfa', mfaToken: this.tokens.signStep('mfa', admin) };
    }
    return {
      step: 'mfa_setup',
      setupToken: this.tokens.signStep('mfa_setup', admin),
    };
  }

  async setupMfa(setupToken: string): Promise<{
    secret: string;
    formattedSecret: string;
    otpauthUri: string;
  }> {
    const admin = await this.carregarEtapa('mfa_setup', setupToken);
    const secret = generateTotpSecret();
    if (!(await this.admins.savePendingMfaSecret(admin.id, secret))) {
      throw new ConflictException(ADMIN_MFA_JA_ATIVO);
    }
    return {
      secret,
      formattedSecret: secret.match(/.{1,4}/g)?.join(' ') ?? secret,
      otpauthUri: buildOtpauthUri(secret, admin.email, ADMIN_MFA_ISSUER),
    };
  }

  async enableMfa(
    setupToken: string,
    code: string,
  ): Promise<AdminSession & { recoveryCodes: string[] }> {
    const admin = await this.carregarEtapa('mfa_setup', setupToken);
    await this.assertMfaNaoBloqueado(admin.id);
    if (!admin.mfaPendingSecret) {
      throw new BadRequestException(
        'Inicie a configuração da verificação em duas etapas novamente.',
      );
    }

    const step = verifyTotp(admin.mfaPendingSecret, code);
    if (step === null) return this.falhaMfa(admin.id);

    const recoveryCodes = generateRecoveryCodes();
    const ativado = await this.admins.enableMfa(admin.id, {
      secret: admin.mfaPendingSecret,
      recoveryCodeHashes: this.hashes(recoveryCodes),
      usedStep: step,
    });
    if (!ativado) throw new ConflictException(ADMIN_MFA_JA_ATIVO);

    await this.limiter.clearMfaFailures(this.chaveMfa(admin.id));
    this.logger.log(`[ADMIN_MFA_ENABLED] adminId=${admin.id}`);
    const sessao = await this.emitirSessao({
      ...admin,
      mfaEnabledAt: new Date(),
    });
    return { ...sessao, recoveryCodes };
  }

  async loginWithMfa(mfaToken: string, code: string): Promise<AdminSession> {
    const admin = await this.carregarEtapa('mfa', mfaToken);
    await this.verificarSegundoFator(admin, code, true);
    return this.emitirSessao(admin);
  }

  async refresh(rawToken: string): Promise<AdminSession> {
    const consumed = await this.refreshStore.consume(rawToken);

    if (consumed.status === 'reused') {
      this.logger.error(
        `[ADMIN_REFRESH_REUSE] Reuso de refresh token do painel adminId=${consumed.userId} familyId=${consumed.familyId ?? 'legado'}. Revogando todas as sessões.`,
      );
      await this.revokeAllSessions(consumed.userId);
      throw new UnauthorizedException(
        'Sessão revogada por segurança. Faça login novamente.',
      );
    }
    if (consumed.status === 'grace_exhausted') {
      throw new ConflictException(
        'Sessão já renovada em outra aba. Tente novamente.',
      );
    }
    if (consumed.status !== 'valid' && consumed.status !== 'grace') {
      throw new BadRequestException('Refresh token inválido');
    }

    const admin = await this.admins.findSession(consumed.userId);
    if (
      !admin ||
      admin.status !== PlatformAdminStatus.ACTIVE ||
      !admin.mfaEnabledAt
    ) {
      await this.refreshStore.revokeAllForUser(consumed.userId);
      throw new UnauthorizedException(ADMIN_SESSAO_INVALIDA);
    }
    if (
      typeof consumed.tokenVersion === 'number' &&
      consumed.tokenVersion !== (admin.tokenVersion ?? 0)
    ) {
      throw new UnauthorizedException('Sessão revogada. Faça login novamente.');
    }

    return this.emitirSessao(admin, consumed.familyId);
  }

  async logout(input: {
    accessToken?: string | null;
    refreshToken?: string | null;
  }): Promise<void> {
    const ids = new Set<string>();
    if (input.accessToken) {
      try {
        ids.add(this.tokens.verifyAccess(input.accessToken).adminId);
      } catch {}
    }
    if (input.refreshToken) {
      const consumed = await this.refreshStore.consume(input.refreshToken);
      if (consumed.status !== 'not_found') ids.add(consumed.userId);
    }
    for (const id of ids) {
      await this.refreshStore.revokeAllForUser(id);
    }
  }

  async me(adminId: string): Promise<AdminProfile> {
    const admin = await this.admins.findSession(adminId);
    if (!admin) throw new UnauthorizedException(ADMIN_SESSAO_INVALIDA);
    return adminProfile(admin);
  }

  async regenerateRecoveryCodes(
    adminId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const admin = await this.carregarMfa(adminId);
    await this.verificarSegundoFator(admin, code, false);
    const recoveryCodes = generateRecoveryCodes();
    const salvo = await this.admins.replaceMfaRecoveryCodes(
      adminId,
      this.hashes(recoveryCodes),
    );
    if (!salvo) {
      throw new BadRequestException(
        'A verificação em duas etapas não está ativa.',
      );
    }
    this.logger.log(`[ADMIN_MFA_RECOVERY_REGENERATED] adminId=${adminId}`);
    return { recoveryCodes };
  }

  async acceptInvite(
    email: string,
    token: string,
    password: string,
  ): Promise<void> {
    const chave = `${CHAVE_LIMITE}invite:${email}`;
    if (await this.limiter.isRecoveryValidationLocked(chave)) {
      throw new BadRequestException(ADMIN_CONVITE_INVALIDO);
    }

    const admin = await this.admins.findInvite(email);
    const valido =
      !!admin &&
      admin.status === PlatformAdminStatus.PENDING &&
      !!admin.inviteExpiresAt &&
      admin.inviteExpiresAt.getTime() > Date.now() &&
      inviteTokenConfere(token, admin.inviteTokenHash);

    if (!admin || !valido || !admin.inviteTokenHash) {
      await this.limiter.registerRecoveryFailure(chave);
      throw new BadRequestException(ADMIN_CONVITE_INVALIDO);
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const aceito = await this.admins.acceptInvite(
      admin.id,
      admin.inviteTokenHash,
      passwordHash,
    );
    if (!aceito) {
      await this.limiter.registerRecoveryFailure(chave);
      throw new BadRequestException(ADMIN_CONVITE_INVALIDO);
    }
    await this.refreshStore.revokeAllForUser(admin.id).catch((err: unknown) => {
      this.logger.warn(
        `Falha ao limpar sessões do administrador ${admin.id}: ${errorMessage(err)}`,
      );
    });
    this.logger.log(`[ADMIN_INVITE_ACCEPTED] adminId=${admin.id}`);
  }

  async revokeAllSessions(adminId: string): Promise<void> {
    await this.admins.incrementTokenVersion(adminId);
    await this.refreshStore.revokeAllForUser(adminId);
  }

  private async emitirSessao(
    admin: PlatformAdmin,
    familyId?: string | null,
  ): Promise<AdminSession> {
    const refreshToken = await this.refreshStore.issue(
      admin.id,
      admin.tokenVersion ?? 0,
      familyId,
    );
    this.admins.touchLastSeen(admin.id).catch((err: unknown) => {
      this.logger.warn(
        `Falha ao gravar último acesso do administrador ${admin.id}: ${errorMessage(err)}`,
      );
    });
    return {
      accessToken: this.tokens.signAccess(admin),
      refreshToken,
      admin: adminProfile(admin),
    };
  }

  private async carregarEtapa(
    purpose: AdminStepPurpose,
    token: string,
  ): Promise<PlatformAdmin> {
    const { adminId, tv } = this.tokens.verifyStep(purpose, token);
    const admin = await this.admins.findMfaState(adminId);
    if (
      !admin ||
      admin.status !== PlatformAdminStatus.ACTIVE ||
      (admin.tokenVersion ?? 0) !== tv
    ) {
      throw new UnauthorizedException(ADMIN_ETAPA_EXPIRADA);
    }
    if (purpose === 'mfa_setup' && admin.mfaEnabledAt) {
      throw new ConflictException(ADMIN_MFA_JA_ATIVO);
    }
    if (purpose === 'mfa' && !admin.mfaEnabledAt) {
      throw new UnauthorizedException(ADMIN_ETAPA_EXPIRADA);
    }
    return admin;
  }

  private async carregarMfa(adminId: string): Promise<PlatformAdmin> {
    const admin = await this.admins.findMfaState(adminId);
    if (!admin || admin.status !== PlatformAdminStatus.ACTIVE) {
      throw new UnauthorizedException(ADMIN_SESSAO_INVALIDA);
    }
    return admin;
  }

  private async verificarSegundoFator(
    admin: PlatformAdmin,
    code: string,
    allowRecovery: boolean,
  ): Promise<void> {
    await this.assertMfaNaoBloqueado(admin.id);
    if (!admin.mfaEnabledAt || !admin.mfaSecret) {
      throw new BadRequestException(
        'A verificação em duas etapas não está ativa.',
      );
    }

    if (isTotpFormat(code)) {
      const step = verifyTotp(admin.mfaSecret, code);
      if (step !== null && (await this.admins.consumeMfaStep(admin.id, step))) {
        await this.limiter.clearMfaFailures(this.chaveMfa(admin.id));
        return;
      }
      return this.falhaMfa(admin.id);
    }

    if (allowRecovery && isRecoveryCodeFormat(code)) {
      const hash = findRecoveryCodeHash(
        admin.mfaRecoveryCodes,
        hashRecoveryCode(code, this.recoveryPepper()),
      );
      if (hash && (await this.admins.consumeMfaRecoveryCode(admin.id, hash))) {
        await this.limiter.clearMfaFailures(this.chaveMfa(admin.id));
        this.logger.log(`[ADMIN_MFA_RECOVERY_USED] adminId=${admin.id}`);
        return;
      }
    }

    return this.falhaMfa(admin.id);
  }

  private chaveMfa(adminId: string): string {
    return `${CHAVE_LIMITE}${adminId}`;
  }

  private async assertMfaNaoBloqueado(adminId: string): Promise<void> {
    if (await this.limiter.isMfaLocked(this.chaveMfa(adminId))) {
      throw new HttpException(MFA_BLOQUEADO, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async falhaMfa(adminId: string): Promise<never> {
    const bloqueou = await this.limiter.registerMfaFailure(
      this.chaveMfa(adminId),
    );
    if (bloqueou) {
      this.logger.warn(`[ADMIN_MFA_LOCKED] adminId=${adminId}`);
      throw new HttpException(MFA_BLOQUEADO, HttpStatus.TOO_MANY_REQUESTS);
    }
    throw new BadRequestException(MFA_CODIGO_INVALIDO);
  }

  private hashes(codigos: string[]): string[] {
    const pepper = this.recoveryPepper();
    return codigos.map((c) => hashRecoveryCode(c, pepper));
  }

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

  private obterHashFicticio(): Promise<string> {
    if (!this.hashFicticio) {
      this.hashFicticio = bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
    }
    return this.hashFicticio;
  }
}
