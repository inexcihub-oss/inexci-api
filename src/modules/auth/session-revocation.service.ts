import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRepository } from 'src/database/repositories/user.repository';
import { RefreshTokenStore } from './refresh-token.store';

export const USER_SESSIONS_REVOKED = 'user.sessions_revoked';

export type SessionRevocationReason =
  | 'logout'
  | 'password_changed'
  | 'password_reset'
  | 'deactivated'
  | 'deleted'
  | 'refresh_reuse'
  | 'mfa_disabled';

export interface UserSessionsRevokedEvent {
  userId: string;
  reason: SessionRevocationReason;
  accessTokensRevoked: boolean;
}

@Injectable()
export class SessionRevocationService {
  private readonly logger = new Logger(SessionRevocationService.name);

  constructor(
    private readonly refreshTokenStore: RefreshTokenStore,
    private readonly userRepository: UserRepository,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  async revokeAllSessions(
    userId: string,
    reason: SessionRevocationReason,
  ): Promise<void> {
    await this.userRepository.incrementTokenVersion(userId);
    await this.refreshTokenStore.revokeAllForUser(userId);
    this.logger.log(
      `[AUTH_SESSIONS_REVOKED] userId=${userId} reason=${reason} access=true`,
    );
    this.emit({ userId, reason, accessTokensRevoked: true });
  }

  async revokeRefreshTokens(
    userId: string,
    reason: SessionRevocationReason,
  ): Promise<void> {
    await this.refreshTokenStore.revokeAllForUser(userId);
    this.emit({ userId, reason, accessTokensRevoked: false });
  }

  private emit(event: UserSessionsRevokedEvent): void {
    this.eventEmitter?.emit(USER_SESSIONS_REVOKED, event);
  }
}
