import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import {
  AdminGatewayEventRow,
  AdminGatewayEventsRepository,
} from 'src/database/repositories/admin-gateway-events.repository';
import { BillingWebhookService } from 'src/modules/billing/services/billing-webhook.service';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from 'src/shared/payment-gateway/payment-gateway.interface';
import { maskSensitiveText } from 'src/shared/utils/mask.util';
import { errorMessage } from 'src/shared/utils/error-message.util';
import { PlatformAuditService } from '../audit/platform-audit.service';
import {
  AdminGatewayEventDto,
  AdminGatewayEventsResponseDto,
  ReprocessGatewayEventResultDto,
} from './dto/admin-gateway-events.dto';
import {
  SUBSCRIPTION_NOT_IDENTIFIED,
  gatewayEventLabel,
  needsSubscription,
} from './gateway-event-labels';

export const STALE_AFTER_MS = 60 * 60 * 1000;
export const EVENTO_JA_PROCESSADO = 'Este evento já foi processado.';
const ERROR_MAX_LENGTH = 300;

@Injectable()
export class AdminGatewayEventsService {
  constructor(
    private readonly repository: AdminGatewayEventsRepository,
    private readonly webhook: BillingWebhookService,
    private readonly audit: PlatformAuditService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async list(
    params: {
      ownerId?: string;
      problems?: boolean;
      limit: number;
      offset: number;
    },
    now: Date = new Date(),
  ): Promise<AdminGatewayEventsResponseDto> {
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
    const [{ items, total }, counts] = await Promise.all([
      this.repository.search({
        ownerId: params.ownerId,
        onlyProblems: params.problems,
        staleBefore,
        limit: params.limit,
        offset: params.offset,
      }),
      this.repository.countProblems(staleBefore),
    ]);
    return {
      items: items.map((row) => this.toDto(row, staleBefore)),
      total,
      counts,
    };
  }

  async reprocess(
    id: string,
    reason: string,
    actorAdminId: string,
  ): Promise<ReprocessGatewayEventResultDto> {
    const row = await this.repository.findResolved(id);
    if (!row) throw new NotFoundException('Evento não encontrado.');
    if (row.processedAt) throw new ConflictException(EVENTO_JA_PROCESSADO);

    const entry = await this.audit.begin({
      actorAdminId,
      action: PlatformAuditAction.STRIPE_EVENT_REPROCESSED,
      targetOwnerId: row.ownerId,
      reason,
      before: {
        eventId: row.eventId,
        eventType: row.eventType,
        error: row.error ? this.safeError(row.error) : null,
      },
    });

    try {
      const result = await this.webhook.reprocessStored(id);
      await this.audit.succeed(entry.id, {
        after: { processedAt: result.processedAt.toISOString() },
        gatewayRef: row.eventId,
      });
      return {
        auditLogId: entry.id,
        id,
        processedAt: result.processedAt,
      };
    } catch (err) {
      const message = this.safeError(errorMessage(err));
      await this.audit.fail(entry.id, message, row.eventId);
      if (err instanceof HttpException) throw err;
      throw new UnprocessableEntityException(
        `O reprocessamento falhou: ${message}`,
      );
    }
  }

  private toDto(
    row: AdminGatewayEventRow,
    staleBefore: Date,
  ): AdminGatewayEventDto {
    const situation = row.processedAt
      ? 'processed'
      : row.error
        ? 'failed'
        : 'pending';
    const subscriptionRef = this.subscriptionRefOf(row.payload);
    return {
      id: row.id,
      eventId: row.eventId,
      eventType: row.eventType,
      gatewayType: row.gatewayType,
      label: gatewayEventLabel(row.eventType),
      situation,
      stale: situation === 'pending' && row.createdAt < staleBefore,
      createdAt: row.createdAt,
      processedAt: row.processedAt,
      error: row.error ? this.safeError(row.error) : null,
      ownerId: row.ownerId,
      ownerName: row.ownerName,
      customerId: row.customerId,
      subscriptionRef,
      warning:
        needsSubscription(row.eventType) && !subscriptionRef
          ? SUBSCRIPTION_NOT_IDENTIFIED
          : null,
    };
  }

  private subscriptionRefOf(payload: unknown): string | null {
    try {
      return (
        this.gateway.parseWebhookEvent(payload).refs?.subscriptionId ?? null
      );
    } catch {
      return null;
    }
  }

  private safeError(value: string): string {
    return maskSensitiveText(value).slice(0, ERROR_MAX_LENGTH);
  }
}
