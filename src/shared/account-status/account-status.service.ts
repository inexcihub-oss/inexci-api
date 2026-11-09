import { Injectable, Logger } from '@nestjs/common';
import { UserRepository } from 'src/database/repositories/user.repository';
import { errorMessage } from 'src/shared/utils/error-message.util';

export const ACCOUNT_STATUS_CACHE_TTL_MS = 30 * 1000;

@Injectable()
export class AccountStatusService {
  private readonly logger = new Logger(AccountStatusService.name);
  private readonly cache = new Map<
    string,
    { deactivated: boolean; expiresAt: number }
  >();

  constructor(private readonly userRepository: UserRepository) {}

  async isDeactivated(
    ownerId: string | null | undefined,
    now: number = Date.now(),
  ): Promise<boolean> {
    if (!ownerId) return false;
    const cached = this.cache.get(ownerId);
    if (cached && cached.expiresAt > now) return cached.deactivated;
    try {
      const deactivated =
        await this.userRepository.isAccountDeactivated(ownerId);
      this.cache.set(ownerId, {
        deactivated,
        expiresAt: now + ACCOUNT_STATUS_CACHE_TTL_MS,
      });
      return deactivated;
    } catch (err) {
      this.logger.warn(
        `Situação da conta ${ownerId} indisponível, seguindo com o envio: ${errorMessage(err)}`,
      );
      return false;
    }
  }
}
