import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { In } from 'typeorm';

import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { User, UserStatus } from 'src/database/entities/user.entity';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

import { MailService } from 'src/shared/mail/mail.service';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { getStatusLabel } from 'src/shared/utils';

import { PendencyValidatorService } from 'src/modules/surgery-requests/pendencies/pendency-validator.service';

interface WeeklyHighlight {
  protocol: string;
  patientName: string;
  statusLabel: string;
  pendingLabel?: string;
}

interface WeeklyCounts {
  created: number;
  statusChanged: number;
  finalized: number;
  withPendingBlocking: number;
}

@Injectable()
export class WeeklySummaryService {
  private readonly logger = new Logger(WeeklySummaryService.name);

  /** Status considerados ativos (não fechados/finalizados) — usados para highlights de pendências. */
  private readonly OPEN_STATUSES: SurgeryRequestStatus[] = [
    SurgeryRequestStatus.PENDING,
    SurgeryRequestStatus.SENT,
    SurgeryRequestStatus.IN_ANALYSIS,
    SurgeryRequestStatus.IN_SCHEDULING,
    SurgeryRequestStatus.SCHEDULED,
    SurgeryRequestStatus.PERFORMED,
    SurgeryRequestStatus.INVOICED,
  ];

  constructor(
    private readonly userRepository: UserRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly settingsRepository: UserNotificationSettingsRepository,
    private readonly mailService: MailService,
    private readonly accessControlService: AccessControlService,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Envia o resumo semanal para todos os usuários ativos da plataforma que
   * tenham e-mail e cujo `weeklyReport` não esteja desligado nas preferências.
   *
   * @returns número de e-mails enfileirados
   */
  async sendWeeklySummariesForAllUsers(
    now: Date = new Date(),
  ): Promise<number> {
    const { start, end } = this.getLastWeekRange(now);

    const users = await this.userRepository['repository'].find({
      where: { status: UserStatus.ACTIVE },
      relations: ['doctorProfile'],
    });

    let dispatched = 0;

    await Promise.all(
      users.map(async (user) => {
        try {
          const sent = await this.dispatchForUser(user, start, end);
          if (sent) dispatched++;
        } catch (err: any) {
          this.logger.warn(
            `Falha ao enviar resumo semanal para userId=${user.id}: ${err?.message ?? err}`,
          );
        }
      }),
    );

    this.logger.log(
      `Resumo semanal: ${dispatched} e-mails enfileirados de ${users.length} usuários elegíveis`,
    );
    return dispatched;
  }

  /**
   * Calcula o resumo de um usuário individual e dispara o e-mail.
   * Retorna true se o e-mail foi enfileirado.
   */
  async dispatchForUser(user: User, start: Date, end: Date): Promise<boolean> {
    if (!user.email) return false;

    const settings = await this.settingsRepository.findByUserId(user.id);

    // Opt-out explícito do resumo semanal bloqueia o envio. O resumo
    // semanal é o único e-mail enviado a usuários do sistema, então o
    // único toggle relevante aqui é `weeklyReport`.
    if (settings && settings.weeklyReport === false) return false;

    const doctorIds = await this.accessControlService
      .getAccessibleDoctorIds(user.id)
      .catch(() => [] as string[]);

    if (!doctorIds.length) return false;

    const summary = await this.buildSummary(doctorIds, start, end);

    // Não envia se não há nenhum movimento na semana E nenhuma pendência aberta.
    const hasMovement =
      summary.counts.created > 0 ||
      summary.counts.statusChanged > 0 ||
      summary.counts.finalized > 0 ||
      summary.counts.withPendingBlocking > 0;
    if (!hasMovement) return false;

    const dashboardUrl = this.configService.get<string>('DASHBOARD_URL') ?? '';
    const preferencesUrl = dashboardUrl
      ? `${dashboardUrl}/configuracoes/notificacoes`
      : undefined;

    await this.mailService.sendWeeklySummary(user.email, {
      userName: user.name,
      periodStart: this.formatDate(start),
      periodEnd: this.formatDate(end),
      counts: summary.counts,
      highlights: summary.highlights,
      dashboardUrl: dashboardUrl
        ? `${dashboardUrl}/solicitacoes-cirurgicas`
        : undefined,
      preferencesUrl,
    });

    return true;
  }

  /**
   * Busca solicitações dos médicos acessíveis e gera contadores + destaques.
   */
  private async buildSummary(
    doctorIds: string[],
    start: Date,
    end: Date,
  ): Promise<{ counts: WeeklyCounts; highlights: WeeklyHighlight[] }> {
    const repo = this.surgeryRequestRepository['repository'];

    // Janela [start, end) — start inclusivo, end exclusivo.
    const requests = await repo.find({
      where: { doctorId: In(doctorIds) },
      relations: ['patient'],
      order: { lastStatusChangedAt: 'DESC' },
    });

    const created = requests.filter(
      (r) => r.createdAt >= start && r.createdAt < end,
    );
    const statusChanged = requests.filter(
      (r) =>
        r.lastStatusChangedAt &&
        r.lastStatusChangedAt >= start &&
        r.lastStatusChangedAt < end,
    );
    const finalized = statusChanged.filter(
      (r) => r.status === SurgeryRequestStatus.FINALIZED,
    );

    // Pendências bloqueantes em SCs ativas.
    const openRequests = requests.filter((r) =>
      this.OPEN_STATUSES.includes(r.status),
    );

    const highlights: WeeklyHighlight[] = [];
    let withPendingBlocking = 0;

    // Limita o cálculo de pendências a 30 SCs por usuário para evitar custo
    // excessivo no cron. Considera as 30 mais recentemente movimentadas.
    const limitedOpen = openRequests.slice(0, 30);

    for (const request of limitedOpen) {
      try {
        const summary = await this.pendencyValidator.getSummary(request.id);
        if (summary.pending > 0) {
          withPendingBlocking++;
          highlights.push({
            protocol: request.protocol ?? request.id,
            patientName: request.patient?.name ?? 'Paciente',
            statusLabel: getStatusLabel(request.status),
            pendingLabel:
              summary.pending === 1
                ? '1 pendência bloqueante'
                : `${summary.pending} pendências bloqueantes`,
          });
        }
      } catch (err: any) {
        this.logger.debug(
          `Falha ao calcular pendências para SC ${request.id}: ${err?.message ?? err}`,
        );
      }
    }

    // Inclui também as movimentadas na semana (até atingir 10 destaques).
    for (const request of statusChanged) {
      if (highlights.length >= 10) break;
      if (
        highlights.some((h) => h.protocol === (request.protocol ?? request.id))
      ) {
        continue;
      }
      highlights.push({
        protocol: request.protocol ?? request.id,
        patientName: request.patient?.name ?? 'Paciente',
        statusLabel: getStatusLabel(request.status),
      });
    }

    return {
      counts: {
        created: created.length,
        statusChanged: statusChanged.length,
        finalized: finalized.length,
        withPendingBlocking,
      },
      highlights: highlights.slice(0, 10),
    };
  }

  /**
   * Janela da última semana (segunda 00:00 → segunda 00:00 seguinte).
   * Quando rodado num domingo às 08:00, devolve a semana ISO anterior completa.
   */
  getLastWeekRange(reference: Date): { start: Date; end: Date } {
    const ref = new Date(reference);
    const day = ref.getUTCDay(); // 0 = domingo
    // Segunda-feira da semana atual em UTC
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(ref);
    monday.setUTCDate(ref.getUTCDate() - diffToMonday);
    monday.setUTCHours(0, 0, 0, 0);

    const start = new Date(monday);
    start.setUTCDate(monday.getUTCDate() - 7);
    const end = new Date(monday);
    return { start, end };
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
