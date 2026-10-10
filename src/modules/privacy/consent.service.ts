import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { User } from '../../database/entities/user.entity';
import { UserRepository } from '../../database/repositories/user.repository';
import { ConsentType, REQUIRED_CONSENTS } from '../../config/consent.config';

export interface ConsentStatus {
  privacyPolicyAcceptedAt: Date | null;
  termsOfUseAcceptedAt: Date | null;
  aiConsentAcceptedAt: Date | null;
  requiredConsentsAccepted: boolean;
  pendingRequired: ConsentType[];
}

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(private readonly userRepo: UserRepository) {}

  async getStatus(userId: string): Promise<ConsentStatus> {
    const user = await this.findUserOrThrow(userId);
    return this.buildStatusFromUser(user);
  }

  async acceptTerms(userId: string): Promise<ConsentStatus> {
    const user = await this.findUserOrThrow(userId);
    const now = new Date();
    await this.userRepo.update(userId, {
      privacyPolicyAcceptedAt: now,
      termsOfUseAcceptedAt: now,
    });
    this.logger.log(`[CONSENT_TERMS_ACCEPTED] user=${userId}`);
    return this.buildStatusFromUser({
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
    return this.buildStatusFromUser({ ...user, aiConsentAcceptedAt: now });
  }

  async revokeAi(userId: string): Promise<ConsentStatus> {
    const user = await this.findUserOrThrow(userId);
    await this.userRepo.update(userId, { aiConsentAcceptedAt: null });
    this.logger.warn(`[CONSENT_AI_REVOKED] user=${userId}`);
    return this.buildStatusFromUser({ ...user, aiConsentAcceptedAt: null });
  }

  hasValidAiConsent(user: Pick<User, 'aiConsentAcceptedAt'>): boolean {
    return Boolean(user?.aiConsentAcceptedAt);
  }

  private async findUserOrThrow(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return user;
  }

  buildStatusFromUser(
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
