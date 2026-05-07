import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import {
  ConsentLog,
  ConsentType,
} from '../../database/entities/consent-log.entity';
import { ConsentLogRepository } from '../../database/repositories/consent-log.repository';
import {
  CURRENT_CONSENT_VERSIONS,
  REQUIRED_CONSENTS,
  isConsentVersionValid,
} from '../../config/consent.config';

export interface ConsentStatus {
  type: ConsentType;
  isAccepted: boolean;
  isRequired: boolean;
  acceptedVersion: string | null;
  currentVersion: string;
  acceptedAt: Date | null;
}

interface ConsentMeta {
  ip?: string | null;
  userAgent?: string | null;
  channel?: 'web' | 'mobile' | 'api' | 'admin';
}

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly consentLogRepo: ConsentLogRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Estado dos três consentimentos do usuário, comparado com a versão vigente. */
  async getStatus(userId: string): Promise<ConsentStatus[]> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return (Object.keys(CURRENT_CONSENT_VERSIONS) as ConsentType[]).map(
      (type) => this.buildStatusForType(user, type),
    );
  }

  /** Lista os tipos pendentes (obrigatórios não aceitos ou com MAJOR desatualizado). */
  async getPending(userId: string): Promise<ConsentType[]> {
    const status = await this.getStatus(userId);
    return status
      .filter((s) => s.isRequired && !s.isAccepted)
      .map((s) => s.type);
  }

  /** Verifica consentimento de IA (chamado pelo orchestrator). */
  async hasValidAiConsent(
    user: Pick<User, 'ai_consent_version'>,
  ): Promise<boolean> {
    return isConsentVersionValid(
      user.ai_consent_version,
      CURRENT_CONSENT_VERSIONS.ai,
    );
  }

  async grant(
    userId: string,
    type: ConsentType,
    version: string,
    meta: ConsentMeta = {},
  ): Promise<ConsentStatus> {
    const currentVersion = CURRENT_CONSENT_VERSIONS[type];
    if (!currentVersion) {
      throw new BadRequestException(`Tipo de consentimento inválido: ${type}.`);
    }
    if (!isConsentVersionValid(version, currentVersion)) {
      throw new BadRequestException(
        `Versão informada (${version}) é incompatível com a versão vigente (${currentVersion}).`,
      );
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const now = new Date();
    const updates: Partial<User> = {};
    switch (type) {
      case 'ai':
        updates.ai_consent_at = now;
        updates.ai_consent_version = version;
        break;
      case 'privacy_policy':
        updates.privacy_policy_consent_at = now;
        updates.privacy_policy_consent_version = version;
        break;
      case 'terms_of_use':
        updates.terms_of_use_consent_at = now;
        updates.terms_of_use_consent_version = version;
        break;
    }
    await this.userRepo.update(userId, updates);

    await this.consentLogRepo.create({
      user_id: userId,
      consent_type: type,
      version,
      action: 'granted',
      ip_address: meta.ip ?? null,
      user_agent: meta.userAgent ?? null,
      channel: meta.channel ?? 'web',
    });

    this.logger.log(
      `[CONSENT_GRANTED] user=${userId} type=${type} version=${version} channel=${meta.channel ?? 'web'}`,
    );

    const refreshed = await this.userRepo.findOne({ where: { id: userId } });
    return this.buildStatusForType(refreshed!, type);
  }

  async revoke(
    userId: string,
    type: ConsentType,
    meta: ConsentMeta = {},
  ): Promise<ConsentStatus> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const updates: Partial<User> = {};
    switch (type) {
      case 'ai':
        updates.ai_consent_at = null;
        updates.ai_consent_version = null;
        break;
      case 'privacy_policy':
        updates.privacy_policy_consent_at = null;
        updates.privacy_policy_consent_version = null;
        break;
      case 'terms_of_use':
        updates.terms_of_use_consent_at = null;
        updates.terms_of_use_consent_version = null;
        break;
    }
    await this.userRepo.update(userId, updates);

    await this.consentLogRepo.create({
      user_id: userId,
      consent_type: type,
      version: CURRENT_CONSENT_VERSIONS[type],
      action: 'revoked',
      ip_address: meta.ip ?? null,
      user_agent: meta.userAgent ?? null,
      channel: meta.channel ?? 'web',
    });

    this.logger.warn(
      `[CONSENT_REVOKED] user=${userId} type=${type} channel=${meta.channel ?? 'web'}`,
    );

    if (type === 'ai') {
      this.eventEmitter.emit('ai.consent.revoked', { userId });
    }

    const refreshed = await this.userRepo.findOne({ where: { id: userId } });
    return this.buildStatusForType(refreshed!, type);
  }

  async getHistory(
    userId: string,
    type?: ConsentType,
    limit = 50,
  ): Promise<ConsentLog[]> {
    return this.consentLogRepo.findHistory(userId, type, limit);
  }

  private buildStatusForType(user: User, type: ConsentType): ConsentStatus {
    const currentVersion = CURRENT_CONSENT_VERSIONS[type];
    const isRequired = REQUIRED_CONSENTS.includes(type);

    let acceptedVersion: string | null = null;
    let acceptedAt: Date | null = null;
    switch (type) {
      case 'ai':
        acceptedVersion = user.ai_consent_version;
        acceptedAt = user.ai_consent_at;
        break;
      case 'privacy_policy':
        acceptedVersion = user.privacy_policy_consent_version;
        acceptedAt = user.privacy_policy_consent_at;
        break;
      case 'terms_of_use':
        acceptedVersion = user.terms_of_use_consent_version;
        acceptedAt = user.terms_of_use_consent_at;
        break;
    }

    return {
      type,
      isAccepted: isConsentVersionValid(acceptedVersion, currentVersion),
      isRequired,
      acceptedVersion,
      currentVersion,
      acceptedAt,
    };
  }
}
