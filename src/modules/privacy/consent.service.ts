import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { ConsentType, REQUIRED_CONSENTS } from '../../config/consent.config';

export interface ConsentStatus {
  privacyPolicyAcceptedAt: Date | null;
  termsOfUseAcceptedAt: Date | null;
  aiConsentAcceptedAt: Date | null;
  /** True quando Política e Termos estão aceitos (pré-requisito de uso). */
  requiredConsentsAccepted: boolean;
  /** Quais consentimentos obrigatórios ainda faltam. */
  pendingRequired: ConsentType[];
}

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getStatus(userId: string): Promise<ConsentStatus> {
    const user = await this.findUserOrThrow(userId);
    return this.buildStatus(user);
  }

  /** Aceita Política de Privacidade e Termos de Uso de uma só vez. */
  async acceptTerms(userId: string): Promise<ConsentStatus> {
    const user = await this.findUserOrThrow(userId);
    const now = new Date();
    await this.userRepo.update(userId, {
      privacyPolicyAcceptedAt: now,
      termsOfUseAcceptedAt: now,
    });
    this.logger.log(`[CONSENT_TERMS_ACCEPTED] user=${userId}`);
    return this.buildStatus({
      ...user,
      privacyPolicyAcceptedAt: now,
      termsOfUseAcceptedAt: now,
    });
  }

  async grantAi(userId: string): Promise<ConsentStatus> {
    const user = await this.findUserOrThrow(userId);
    const now = new Date();
    await this.userRepo.update(userId, { aiConsentAcceptedAt: now });
    this.logger.log(`[CONSENT_AI_GRANTED] user=${userId}`);
    return this.buildStatus({ ...user, aiConsentAcceptedAt: now });
  }

  async revokeAi(userId: string): Promise<ConsentStatus> {
    const user = await this.findUserOrThrow(userId);
    await this.userRepo.update(userId, { aiConsentAcceptedAt: null });
    this.logger.warn(`[CONSENT_AI_REVOKED] user=${userId}`);
    return this.buildStatus({ ...user, aiConsentAcceptedAt: null });
  }

  /**
   * Helper consumido pelo orchestrator de IA: o usuário pode usar a IA
   * pelo WhatsApp se houver timestamp de aceite.
   */
  hasValidAiConsent(user: Pick<User, 'aiConsentAcceptedAt'>): boolean {
    return Boolean(user?.aiConsentAcceptedAt);
  }

  private async findUserOrThrow(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return user;
  }

  private buildStatus(
    user: Pick<
      User,
      'privacyPolicyAcceptedAt' | 'termsOfUseAcceptedAt' | 'aiConsentAcceptedAt'
    >,
  ): ConsentStatus {
    const pendingRequired: ConsentType[] = [];
    if (!user.privacyPolicyAcceptedAt) pendingRequired.push('privacy_policy');
    if (!user.termsOfUseAcceptedAt) pendingRequired.push('terms_of_use');

    return {
      privacyPolicyAcceptedAt: user.privacyPolicyAcceptedAt ?? null,
      termsOfUseAcceptedAt: user.termsOfUseAcceptedAt ?? null,
      aiConsentAcceptedAt: user.aiConsentAcceptedAt ?? null,
      requiredConsentsAccepted: pendingRequired.length === 0,
      pendingRequired: pendingRequired.filter((t) =>
        REQUIRED_CONSENTS.includes(t),
      ),
    };
  }
}
