import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import {
  PlatformErrorDailyRepository,
  PlatformErrorRecord,
} from 'src/database/repositories/platform-error-daily.repository';
import { getRequestContext } from 'src/shared/logging/request-context';
import { errorMessage } from 'src/shared/utils/error-message.util';
import {
  errorClassOf,
  fingerprintOf,
  normalizeRoute,
  sanitizeErrorMessage,
} from './platform-error-fingerprint';
import {
  PlatformErrorEvent,
  registerPlatformErrorSink,
} from './platform-error-sink';

const SAO_PAULO_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

@Injectable()
export class PlatformErrorRecorder implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformErrorRecorder.name);

  constructor(private readonly repository: PlatformErrorDailyRepository) {}

  onModuleInit(): void {
    registerPlatformErrorSink((event) => {
      void this.record(event);
    });
  }

  onModuleDestroy(): void {
    registerPlatformErrorSink(null);
  }

  buildRecord(
    event: PlatformErrorEvent,
    now: Date = new Date(),
  ): PlatformErrorRecord {
    const ctx = getRequestContext();
    const route = normalizeRoute(event.route);
    const errorClass = errorClassOf(event.error);
    return {
      ownerId: event.ownerId ?? ctx?.tenantId ?? null,
      userId: event.userId ?? ctx?.userId ?? null,
      requestId: event.requestId ?? ctx?.requestId ?? null,
      traceId:
        trace.getActiveSpan()?.spanContext().traceId ?? ctx?.traceId ?? null,
      day: SAO_PAULO_DAY.format(now),
      source: event.source,
      fingerprint: fingerprintOf(event.source, route, errorClass, event.error),
      errorClass,
      route,
      occurredAt: now,
      message: sanitizeErrorMessage(event.error),
    };
  }

  async record(event: PlatformErrorEvent): Promise<void> {
    try {
      const record = this.buildRecord(event);
      await this.repository.increment(record);
    } catch (err) {
      this.logger.warn(
        `[PLATFORM_ERROR_RECORD_FAILED] source=${event.source} err=${errorMessage(err)}`,
      );
    }
  }
}
