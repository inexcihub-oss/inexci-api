import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  PlatformSecurityDailyRepository,
  PlatformSecurityRecord,
  SecurityIdentity,
} from 'src/database/repositories/platform-security-daily.repository';
import { getRequestContext } from 'src/shared/logging/request-context';
import { errorMessage } from 'src/shared/utils/error-message.util';
import {
  PlatformSecurityEvent,
  registerPlatformSecuritySink,
} from './platform-security-sink';

const SAO_PAULO_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

@Injectable()
export class PlatformSecurityRecorder implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformSecurityRecorder.name);

  constructor(private readonly repository: PlatformSecurityDailyRepository) {}

  onModuleInit(): void {
    registerPlatformSecuritySink((event) => {
      const requestId = getRequestContext()?.requestId ?? null;
      void this.record(event, requestId);
    });
  }

  onModuleDestroy(): void {
    registerPlatformSecuritySink(null);
  }

  private async identityOf(
    event: PlatformSecurityEvent,
  ): Promise<SecurityIdentity | null> {
    if (event.userId && event.ownerId !== undefined) {
      return { userId: event.userId, ownerId: event.ownerId };
    }
    if (event.userId) {
      return (
        (await this.repository.identityById(event.userId)) ?? {
          userId: event.userId,
          ownerId: null,
        }
      );
    }
    if (event.email) {
      return this.repository.identityByEmail(event.email);
    }
    return null;
  }

  async buildRecord(
    event: PlatformSecurityEvent,
    requestId: string | null,
    now: Date = new Date(),
  ): Promise<PlatformSecurityRecord | null> {
    const identity = await this.identityOf(event);
    if (!identity && event.type !== 'login_locked') return null;
    return {
      ownerId: identity?.ownerId ?? null,
      userId: identity?.userId ?? null,
      day: SAO_PAULO_DAY.format(now),
      eventType: event.type,
      occurredAt: now,
      requestId,
    };
  }

  async record(
    event: PlatformSecurityEvent,
    requestId: string | null = null,
  ): Promise<void> {
    try {
      const record = await this.buildRecord(event, requestId);
      if (!record) return;
      await this.repository.increment(record);
    } catch (err) {
      this.logger.warn(
        `[PLATFORM_SECURITY_RECORD_FAILED] type=${event.type} err=${errorMessage(err)}`,
      );
    }
  }
}
