import { Injectable, Logger } from '@nestjs/common';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { StaleNotificationLogRepository } from 'src/database/repositories/stale-notification-log.repository';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { WHATSAPP_TEMPLATES } from 'src/shared/whatsapp/whatsapp-templates.constants';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserRole } from 'src/database/entities/user.entity';
import { NotificationType } from 'src/database/entities/notification.entity';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { getStatusLabel, getStalePendencyMessage } from 'src/shared/utils';

export interface StaleTier {
  days: number;
  severity: string;
  notifyWhatsApp: boolean;
  notifyAll: boolean; // true = all stakeholders; false = just responsible + admin
}

export const STALE_TIERS: StaleTier[] = [
  { days: 30, severity: 'critical', notifyWhatsApp: true, notifyAll: true },
  { days: 15, severity: 'alert', notifyWhatsApp: true, notifyAll: false },
  { days: 7, severity: 'attention', notifyWhatsApp: false, notifyAll: false },
  { days: 3, severity: 'reminder', notifyWhatsApp: false, notifyAll: false },
];

@Injectable()
export class StaleNotificationService {
  private readonly logger = new Logger(StaleNotificationService.name);

  constructor(
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly staleLogRepository: StaleNotificationLogRepository,
    private readonly notificationsService: NotificationsService,
    private readonly whatsappService: WhatsappService,
    private readonly userRepository: UserRepository,
  ) {}

  async checkAndNotifyStaleRequests(): Promise<number> {
    let notifiedCount = 0;

    // Check from the smallest tier (3 days) to cover all stale requests
    const minDays = Math.min(...STALE_TIERS.map((t) => t.days));
    const staleRequests =
      await this.surgeryRequestRepository.findStaleRequests(minDays);

    for (const request of staleRequests) {
      try {
        const staleDays = this.calculateStaleDays(request);
        const tier = this.getMatchingTier(staleDays);
        if (!tier) continue;

        const alreadyNotified = await this.staleLogRepository.hasBeenNotified(
          request.id,
          tier.days,
        );
        if (alreadyNotified) continue;

        await this.sendStaleNotifications(request, tier, staleDays);
        await this.staleLogRepository.record(request.id, tier.days, 'in_app');
        notifiedCount++;
      } catch (err: any) {
        this.logger.error(
          `Erro ao processar stale para solicitação ${request.id}: ${err?.message}`,
        );
      }
    }

    this.logger.log(
      `Stale check concluído: ${notifiedCount} notificações enviadas de ${staleRequests.length} solicitações paradas`,
    );
    return notifiedCount;
  }

  private calculateStaleDays(request: SurgeryRequest): number {
    const lastChanged = request.lastStatusChangedAt ?? request.createdAt;
    if (!lastChanged) return 0;
    const now = new Date();
    const diffMs = now.getTime() - new Date(lastChanged).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  getMatchingTier(staleDays: number): StaleTier | null {
    // Return the highest tier the request qualifies for
    for (const tier of STALE_TIERS) {
      if (staleDays >= tier.days) return tier;
    }
    return null;
  }

  private async sendStaleNotifications(
    request: SurgeryRequest,
    tier: StaleTier,
    staleDays: number,
  ): Promise<void> {
    const patientName = request.patient?.name ?? 'Paciente';
    const statusLabel = getStatusLabel(request.status);

    const recipientIds = await this.getStaleRecipients(request, tier);
    if (!recipientIds.length) return;

    const title =
      tier.severity === 'critical'
        ? '⚠️ Solicitação Parada — Ação Imediata'
        : 'Solicitação Parada';
    const message = `A solicitação do paciente ${patientName} está há ${staleDays} dias no status "${statusLabel}"`;

    // Push (in-app + WS) — respeita pushNotifications
    await this.notificationsService.createNotificationForUsers(recipientIds, {
      type: NotificationType.SYSTEM,
      title,
      message,
      link: `/solicitacao/${request.id}`,
      metadata: {
        surgeryRequestId: request.id,
        staleDays,
        severity: tier.severity,
        currentStatus: request.status,
      },
    });

    // WhatsApp — quando o tier exige (15+ dias). E-mail não é mais enviado
    // para usuários do sistema; o único e-mail é o resumo semanal.
    if (tier.notifyWhatsApp) {
      await this.sendStaleWhatsApp(recipientIds, {
        requestProtocol: request.protocol ?? request.id,
        patientName,
        staleDays,
        currentStatus: statusLabel,
        pendencyMessage: getStalePendencyMessage(request.status),
      });
    }
  }

  private async getStaleRecipients(
    request: SurgeryRequest,
    tier: StaleTier,
  ): Promise<string[]> {
    const createdBy = request.createdBy;
    if (!createdBy) return [];

    const allUsersInAccount = await this.userRepository.findByOwnerId(
      createdBy.ownerId,
    );

    const adminIds = allUsersInAccount
      .filter((u) => u.role === UserRole.ADMIN)
      .map((u) => u.id);

    const activityUserIds =
      await this.surgeryRequestRepository.findDistinctActivityUserIds(
        request.id,
      );

    if (tier.notifyAll) {
      return [
        ...new Set([
          request.doctorId,
          request.createdById,
          ...adminIds,
          ...activityUserIds,
        ]),
      ].filter(Boolean);
    }

    return [
      ...new Set([
        request.doctorId,
        request.createdById,
        ...adminIds,
        ...activityUserIds,
      ]),
    ].filter(Boolean);
  }

  private async sendStaleWhatsApp(
    recipientIds: string[],
    context: {
      requestProtocol: string;
      patientName: string;
      staleDays: number;
      currentStatus: string;
      pendencyMessage: string;
    },
  ): Promise<void> {
    await Promise.all(
      recipientIds.map(async (uid) => {
        try {
          const [channels, user] = await Promise.all([
            this.notificationsService.resolveChannels(
              uid,
              NotificationType.SYSTEM,
            ),
            this.userRepository.findOne({ id: uid }),
          ]);
          if (!channels.whatsapp) return;
          if (!user?.phone) return;

          await this.whatsappService.sendTemplate(
            user.phone,
            WHATSAPP_TEMPLATES.STALE_STATUS_MESSAGE,
            {
              '1': user.name ?? 'Usuário',
              '2': context.requestProtocol,
              '3': context.currentStatus,
              '4': `${context.staleDays} ${context.staleDays === 1 ? 'dia' : 'dias'}`,
              '5': context.pendencyMessage,
            },
          );
        } catch (err: any) {
          this.logger.warn(
            `Falha ao enviar WhatsApp stale para ${uid}: ${err?.message}`,
          );
        }
      }),
    );
  }
}
