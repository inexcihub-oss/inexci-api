import { Injectable } from '@nestjs/common';
import { RefreshTokenStore } from 'src/modules/auth/refresh-token.store';

export const ADMIN_REFRESH_KEY_PREFIX = 'admin_refresh:';

@Injectable()
export class AdminRefreshTokenStore extends RefreshTokenStore {
  protected keyPrefix(): string {
    return ADMIN_REFRESH_KEY_PREFIX;
  }
}
