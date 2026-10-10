import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateRequest } from 'twilio';
import {
  SchedulingHandler,
  formatSchedulingOption,
} from 'src/modules/surgery-requests/services/workflow/scheduling.handler';
import { PhoneNormalizerService } from 'src/shared/ai/services/orchestrator/phone-normalizer.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { WHATSAPP_TEMPLATES } from 'src/shared/whatsapp/whatsapp-templates.constants';
import { AppointmentRepository } from 'src/database/repositories/appointment.repository';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';
import { Clinic } from 'src/database/entities/clinic.entity';
import { AppointmentActivityType } from 'src/database/entities/appointment-activity.entity';
import { AppointmentActivityRepository } from 'src/database/repositories/appointment-activity.repository';
import { registrarNoHistorico } from 'src/modules/appointments/appointment-history';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { formatAppointmentWhen, formatClinicAddress } from 'src/shared/utils';
import { errorMessage } from 'src/shared/utils/error-message.util';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  private static readonly SCHEDULING_PATIENT_SELECTED_STATUS_LABEL =
    'Em agendamento';

  private static readonly APPOINTMENT_CONFIRM_TOKENS = [
    'consulta_confirmar',
    'confirmar',
    'confirmo',
  ];

  private static readonly APPOINTMENT_CANCEL_TOKENS = [
    'consulta_cancelar',
    'cancelar',
    'cancela',
  ];

  private static readonly MOTIVO_CANCELAMENTO_PELO_PACIENTE =
    'Cancelada pelo paciente pelo WhatsApp';
  private static readonly APPOINTMENT_LOOKBACK_MS = 6 * 60 * 60 * 1000;
  private static readonly APPOINTMENT_LOOKAHEAD_MS = 26 * 60 * 60 * 1000;

  private static readonly SCHEDULING_PATIENT_SELECTED_NEXT_STEP =
    'Paciente escolheu uma opção de data para a cirurgia. Confirme a data da cirurgia';

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulingHandler: SchedulingHandler,
    private readonly phoneNormalizer: PhoneNormalizerService,
    private readonly whatsappService: WhatsappService,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly notificationsService: NotificationsService,
    private readonly appointmentActivityRepository: AppointmentActivityRepository,
  ) {}

  private parseAppointmentAnswer(
    buttonPayload: string,
    buttonText: string,
  ): 'confirmed' | 'cancelled' | null {
    const candidatos = [buttonPayload, buttonText].map((v) =>
      (v || '').trim().toLowerCase(),
    );

    if (
      WebhookService.APPOINTMENT_CONFIRM_TOKENS.some((t) =>
        candidatos.includes(t),
      )
    ) {
      return 'confirmed';
    }
    if (
      WebhookService.APPOINTMENT_CANCEL_TOKENS.some((t) =>
        candidatos.includes(t),
      )
    ) {
      return 'cancelled';
    }
    return null;
  }

  async tryHandleAppointmentConfirmation(params: {
    from: string;
    messageSid: string;
    buttonPayload: string;
    buttonText: string;
  }): Promise<boolean> {
    const answer = this.parseAppointmentAnswer(
      params.buttonPayload,
      params.buttonText,
    );
    if (!answer) return false;

    const phoneCandidates = this.phoneDigitCandidates(params.from);
    if (phoneCandidates.length === 0) return false;

    const agora = Date.now();
    const appointment = await this.appointmentRepository.findAtivaPorTelefone(
      phoneCandidates,
      {
        from: new Date(agora - WebhookService.APPOINTMENT_LOOKBACK_MS),
        to: new Date(agora + WebhookService.APPOINTMENT_LOOKAHEAD_MS),
      },
    );
    if (!appointment) {
      this.logger.warn(
        `Resposta de lembrete de consulta sem consulta ativa na janela (sid=${params.messageSid})`,
      );
      return false;
    }

    const patientName = appointment.patient?.name ?? 'Paciente';
    const when = formatAppointmentWhen(appointment.scheduledAt);

    const novoStatus =
      answer === 'confirmed'
        ? AppointmentStatus.CONFIRMED
        : AppointmentStatus.CANCELLED;
    if (answer === 'confirmed') {
      await this.appointmentRepository.update(appointment.id, {
        status: novoStatus,
      });
    } else {
      await this.appointmentRepository.update(appointment.id, {
        status: novoStatus,
        cancellationReason: WebhookService.MOTIVO_CANCELAMENTO_PELO_PACIENTE,
      });
    }

    if (appointment.status !== novoStatus) {
      await registrarNoHistorico(
        this.appointmentActivityRepository,
        this.logger,
        {
          appointmentId: appointment.id,
          userId: null,
          type: AppointmentActivityType.STATUS_CHANGE,
          fromStatus: appointment.status,
          toStatus: novoStatus,
          content:
            answer === 'confirmed'
              ? 'Confirmada pelo paciente pelo WhatsApp'
              : WebhookService.MOTIVO_CANCELAMENTO_PELO_PACIENTE,
        },
      );
    }

    await this.notificationsService.notifyAppointmentPatientResponse({
      appointmentId: appointment.id,
      ownerId: appointment.ownerId,
      doctorId: appointment.doctorId,
      patientName,
      when,
      response: answer,
    });

    try {
      await this.whatsappService.sendMessage(
        params.from,
        answer === 'confirmed'
          ? `Obrigado, ${patientName}! Sua consulta de ${when} está confirmada. Até lá!` +
              this.linhaDoLocal(appointment.clinic)
          : `Tudo bem, ${patientName}. Sua consulta de ${when} foi cancelada. Para remarcar, fale com a clínica.`,
      );
    } catch (err) {
      this.logger.warn(
        `Consulta ${appointment.id} ${answer} pelo paciente, mas a confirmação não foi entregue (sid=${params.messageSid}): ${errorMessage(err)}`,
      );
    }

    return true;
  }

  private linhaDoLocal(clinic?: Clinic | null): string {
    const nome = clinic?.name?.trim();
    if (!nome) return '';

    const endereco = formatClinicAddress(clinic ?? null);
    return endereco ? `\n📍 ${nome} — ${endereco}` : `\n📍 ${nome}`;
  }

  private parseSchedulingButtonIndex(
    buttonPayload: string,
    buttonText: string,
  ): number | null {
    const payload = (buttonPayload || '').trim().toLowerCase();
    const text = (buttonText || '').trim().toLowerCase();

    const map: Array<{ patterns: string[]; index: number }> = [
      {
        patterns: ['opcao_1', 'opção_1', 'opcao 1', 'opção 1', 'option 1'],
        index: 0,
      },
      {
        patterns: ['opcao_2', 'opção_2', 'opcao 2', 'opção 2', 'option 2'],
        index: 1,
      },
      {
        patterns: ['opcao_3', 'opção_3', 'opcao 3', 'opção 3', 'option 3'],
        index: 2,
      },
    ];

    for (const item of map) {
      if (
        item.patterns.some((pattern) => payload === pattern || text === pattern)
      ) {
        return item.index;
      }
    }

    return null;
  }

  private phoneDigitCandidates(from: string): string[] {
    return this.phoneNormalizer
      .normalizeInboundPhone(from)
      .lookupCandidates.filter((candidate) => /^\d+$/.test(candidate));
  }

  private async notifyResponsibleDoctorOfSchedulingSelection(request: {
    id: string;
    protocol?: string | null;
    doctor?: { name?: string | null; phone?: string | null } | null;
    patient?: { name?: string | null } | null;
  }): Promise<void> {
    const doctorPhone = request.doctor?.phone;
    if (!doctorPhone) return;

    const doctorName = request.doctor?.name ?? 'Doutor(a)';
    const requestProtocol = request.protocol ?? request.id;
    const patientName = request.patient?.name ?? 'Paciente';

    try {
      await this.whatsappService.sendTemplate(
        doctorPhone,
        WHATSAPP_TEMPLATES.STATUS_CHANGE_USERS,
        {
          '1': doctorName,
          '2': requestProtocol,
          '3': WebhookService.SCHEDULING_PATIENT_SELECTED_STATUS_LABEL,
          '4': WebhookService.SCHEDULING_PATIENT_SELECTED_NEXT_STEP,
          '5': patientName,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Falha ao notificar médico sobre escolha de data do paciente (solicitação ${request.id}): ${errorMessage(err)}`,
      );
    }
  }

  async tryHandleSchedulingSelection(params: {
    from: string;
    messageSid: string;
    buttonPayload: string;
    buttonText: string;
  }): Promise<boolean> {
    const selectedIndex = this.parseSchedulingButtonIndex(
      params.buttonPayload,
      params.buttonText,
    );
    if (selectedIndex === null) return false;

    const phoneDigitCandidates = this.phoneDigitCandidates(params.from);
    if (phoneDigitCandidates.length === 0) return false;

    const result = await this.schedulingHandler.registerPatientDateSelection({
      from: params.from,
      phoneDigitCandidates,
      selectedIndex,
    });

    switch (result.kind) {
      case 'not_found':
        this.logger.warn(
          `Resposta de opção de agendamento sem solicitação correspondente (sid=${params.messageSid})`,
        );
        await this.whatsappService.sendMessage(
          params.from,
          'Não localizei uma solicitação em agendamento para esta resposta. Se precisar, fale com nossa equipe para reenviar as opções.',
        );
        return true;
      case 'ambiguous':
        this.logger.warn(
          `Resposta de opção de agendamento ambígua — mais de uma solicitação para o telefone (sid=${params.messageSid})`,
        );
        await this.whatsappService.sendMessage(
          params.from,
          'Encontrei mais de uma solicitação em agendamento para este número e não consegui identificar a qual sua resposta se refere. Por favor, fale com a clínica para confirmar a data.',
        );
        return true;
      case 'invalid_option':
        await this.whatsappService.sendMessage(
          params.from,
          'Não encontrei essa opção de data para sua solicitação. Por favor, escolha uma das opções enviadas.',
        );
        return true;
    }

    const { request, selectedIso } = result;
    const selectedLabel = formatSchedulingOption(selectedIso);

    await this.notifyResponsibleDoctorOfSchedulingSelection(request);

    const patientName = request.patient?.name ?? 'Paciente';
    await this.whatsappService.sendMessage(
      params.from,
      `Perfeito, ${patientName}! Recebemos sua escolha (${selectedLabel}). Agora o médico irá confirmar o agendamento e você receberá uma nova notificação.`,
    );

    return true;
  }

  validateTwilioSignature(
    signature: string,
    urls: string[],
    body: Record<string, unknown>,
  ): void {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const validateSignatureRaw = this.configService
      .get<string>('TWILIO_VALIDATE_SIGNATURE', '')
      .trim()
      .toLowerCase();
    const explicitlyDisabled =
      validateSignatureRaw === 'false' || validateSignatureRaw === '0';
    const authToken = this.configService
      .get<string>('TWILIO_AUTH_TOKEN', '')
      .trim();

    if (explicitlyDisabled && nodeEnv !== 'production') return;

    if (!authToken) {
      if (nodeEnv === 'production') {
        throw new UnauthorizedException(
          'Configuração de webhook inválida: TWILIO_AUTH_TOKEN ausente',
        );
      }
      return;
    }

    const isValid = urls.some((url) =>
      validateRequest(authToken, signature, url, body),
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }
  }
}
