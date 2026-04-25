import { Injectable, Logger } from '@nestjs/common';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { StaleNotificationLogRepository } from 'src/database/repositories/stale-notification-log.repository';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { WHATSAPP_TEMPLATES } from 'src/shared/whatsapp/whatsapp-templates.constants';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserRole } from 'src/database/entities/user.entity';
import { NotificationType } from 'src/database/entities/notification.entity';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { getStatusLabel } from 'src/shared/utils';

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
    private readonly mailService: MailService,
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
    const lastChanged = request.last_status_changed_at ?? request.created_at;
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
    const createdById = request.created_by_id;

    // Get recipients
    const recipientIds = await this.getStaleRecipients(request, tier);
    if (!recipientIds.length) return;

    // In-app notification
    const title =
      tier.severity === 'critical'
        ? '⚠️ Solicitação Parada — Ação Imediata'
        : 'Solicitação Parada';
    const message = `A solicitação do paciente ${patientName} está há ${staleDays} dias no status "${statusLabel}"`;

    await this.notificationsService.createNotificationForUsers(recipientIds, {
      type: NotificationType.SYSTEM,
      title,
      message,
      link: `/solicitacoes/${request.id}`,
      metadata: {
        surgeryRequestId: request.id,
        staleDays,
        severity: tier.severity,
        currentStatus: request.status,
      },
    });

    // E-mail for recipients with email enabled
    await this.sendStaleEmails(recipientIds, {
      patientName,
      currentStatus: statusLabel,
      staleDays,
      severity: tier.severity,
      dashboardUrl: `/solicitacoes/${request.id}`,
    });

    // WhatsApp for admin (if tier requires)
    if (tier.notifyWhatsApp) {
      await this.sendStaleWhatsApp(recipientIds, {
        patientName,
        staleDays,
        currentStatus: statusLabel,
        severity: tier.severity,
      });
    }
  }

  private async getStaleRecipients(
    request: SurgeryRequest,
    tier: StaleTier,
  ): Promise<string[]> {
    const createdBy = request.created_by;
    if (!createdBy) return [];

    const allUsersInAccount = await this.userRepository.findByAccountId(
      createdBy.account_id,
    );

    const adminIds = allUsersInAccount
      .filter((u) => u.role === UserRole.ADMIN)
      .map((u) => u.id);

    if (tier.notifyAll) {
      // All stakeholders: doctor + creator + admins + activity users
      const activityUserIds =
        await this.surgeryRequestRepository.findDistinctActivityUserIds(
          request.id,
        );
      return [
        ...new Set([
          request.doctor_id,
          request.created_by_id,
          ...adminIds,
          ...activityUserIds,
        ]),
      ].filter(Boolean);
    }

    // Responsible + admin
    return [
      ...new Set([request.doctor_id, request.created_by_id, ...adminIds]),
    ].filter(Boolean);
  }

  private async sendStaleEmails(
    recipientIds: string[],
    context: {
      patientName: string;
      currentStatus: string;
      staleDays: number;
      severity: string;
      dashboardUrl: string;
    },
  ): Promise<void> {
    await Promise.all(
      recipientIds.map(async (uid) => {
        try {
          const user = await this.userRepository.findOne({ id: uid });
          if (!user?.email) return;
          const subject =
            context.severity === 'critical'
              ? '⚠️ Solicitação Parada — Ação Imediata Necessária'
              : 'Solicitação Parada — Lembrete';
          await this.mailService.sendRaw(
            user.email,
            subject,
            `<p>Olá, <strong>${user.name}</strong></p>
             <p>A solicitação do paciente <strong>${context.patientName}</strong> está há <strong>${context.staleDays} dias</strong> no status "${context.currentStatus}".</p>
             <p><a href="${context.dashboardUrl}">Clique aqui para ver a solicitação</a></p>`,
          );
        } catch (err: any) {
          this.logger.warn(
            `Falha ao enviar e-mail stale para ${uid}: ${err?.message}`,
          );
        }
      }),
    );
  }

  private async sendStaleWhatsApp(
    recipientIds: string[],
    context: {
      patientName: string;
      staleDays: number;
      currentStatus: string;
      severity: string;
    },
  ): Promise<void> {
    const templateSid =
      context.severity === 'critical'
        ? WHATSAPP_TEMPLATES.STALE_CRITICAL
        : WHATSAPP_TEMPLATES.STALE_REMINDER;

    if (!templateSid) {
      this.logger.warn('Template WhatsApp de stale não configurado — pulando');
      return;
    }

    await Promise.all(
      recipientIds.map(async (uid) => {
        try {
          const user = await this.userRepository.findOne({ id: uid });
          if (!user?.phone) return;

          if (context.severity === 'critical') {
            await this.whatsappService.sendTemplate(user.phone, templateSid, {
              '1': user.name ?? 'Usuário',
              '2': context.patientName,
              '3': String(context.staleDays),
            });
          } else {
            await this.whatsappService.sendTemplate(user.phone, templateSid, {
              '1': user.name ?? 'Usuário',
              '2': context.patientName,
              '3': String(context.staleDays),
              '4': context.currentStatus,
            });
          }
        } catch (err: any) {
          this.logger.warn(
            `Falha ao enviar WhatsApp stale para ${uid}: ${err?.message}`,
          );
        }
      }),
    );
  }
}
