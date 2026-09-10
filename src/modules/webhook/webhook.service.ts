import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateRequest } from 'twilio';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from 'src/database/repositories/surgery-request-activity.repository';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { WHATSAPP_TEMPLATES } from 'src/shared/whatsapp/whatsapp-templates.constants';
import { AppointmentRepository } from 'src/database/repositories/appointment.repository';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';
import { Clinic } from 'src/database/entities/clinic.entity';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { formatAppointmentWhen, formatClinicAddress } from 'src/shared/utils';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  private static readonly SCHEDULING_PATIENT_SELECTED_STATUS_LABEL =
    'Em agendamento';

  /**
   * Ids do template `appointment_confirmation`, próprios deste fluxo. Os
   * `opcao_*` pertencem ao agendamento cirúrgico e NÃO entram aqui — foi
   * exatamente essa sobreposição que fazia a resposta do paciente à consulta
   * ser lida como escolha de data da cirurgia. O texto do botão entra como
   * fallback para quando o Twilio manda `ButtonText` sem `ButtonPayload`.
   */
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

  /**
   * Janela em que a consulta respondida pode estar. O lembrete sai até 24h
   * antes, e a resposta pode chegar com a consulta recém-passada — daí a folga
   * para trás.
   */
  private static readonly APPOINTMENT_LOOKBACK_MS = 6 * 60 * 60 * 1000;
  private static readonly APPOINTMENT_LOOKAHEAD_MS = 26 * 60 * 60 * 1000;

  private static readonly SCHEDULING_PATIENT_SELECTED_NEXT_STEP =
    'Paciente escolheu uma opção de data para a cirurgia. Confirme a data da cirurgia';

  constructor(
    private readonly configService: ConfigService,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly surgeryRequestActivityRepository: SurgeryRequestActivityRepository,
    private readonly whatsappService: WhatsappService,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Traduz o botão do template `appointment_confirmation`.
   *
   * Só reconhece os ids próprios deste fluxo (ver
   * `APPOINTMENT_CONFIRM_TOKENS`). `opcao_1`/`opcao_2` pertencem ao
   * agendamento cirúrgico e são recusados aqui de propósito.
   */
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

  /**
   * Processa a resposta do paciente ao lembrete de consulta.
   *
   * Localiza a consulta pelo telefone do remetente dentro da janela do lembrete
   * e devolve `false` quando não acha nada — assim uma resposta que não é de
   * consulta segue para o próximo handler.
   *
   * Com ids de botão próprios, este handler e o de agendamento cirúrgico não
   * disputam mais o mesmo payload — a ordem entre os dois no controller passou
   * a ser indiferente.
   */
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

    const phoneCandidates = this.normalizePhoneDigitsCandidates(params.from);
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

    if (answer === 'confirmed') {
      await this.appointmentRepository.update(appointment.id, {
        status: AppointmentStatus.CONFIRMED,
      });
    } else {
      await this.appointmentRepository.update(appointment.id, {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: 'Cancelada pelo paciente pelo WhatsApp',
      });
    }

    await this.notificationsService.notifyAppointmentPatientResponse({
      appointmentId: appointment.id,
      ownerId: appointment.ownerId,
      doctorId: appointment.doctorId,
      patientName,
      when,
      response: answer,
    });

    // Resposta em texto livre: a janela de 24h está aberta porque o paciente
    // acabou de interagir, então não gasta template — e é por isso que o local
    // do atendimento cabe aqui e não no lembrete (variável opcional faria a
    // Meta recusar o envio às consultas sem unidade).
    //
    // Best-effort: o status já está gravado. Deixar a exceção subir faria o
    // controller cair no catch e entregar o clique ao orquestrador de IA, que
    // responderia sobre uma consulta que já mudou de estado.
    try {
      await this.whatsappService.sendMessage(
        params.from,
        answer === 'confirmed'
          ? `Obrigado, ${patientName}! Sua consulta de ${when} está confirmada. Até lá!` +
              this.linhaDoLocal(appointment.clinic)
          : `Tudo bem, ${patientName}. Sua consulta de ${when} foi cancelada. Para remarcar, fale com a clínica.`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Consulta ${appointment.id} ${answer} pelo paciente, mas a confirmação não foi entregue (sid=${params.messageSid}): ${err?.message}`,
      );
    }

    return true;
  }

  /**
   * Linha com o local do atendimento, para anexar à confirmação. Vazia quando a
   * consulta não tem unidade vinculada; só com o nome quando a unidade existe
   * mas não tem endereço cadastrado.
   */
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

  private normalizePhoneDigitsCandidates(from: string): string[] {
    const raw = (from || '').replace(/^whatsapp:/i, '').trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return [];

    const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
    const local =
      withCountry.startsWith('55') && withCountry.length > 11
        ? withCountry.slice(2)
        : withCountry;

    const variants = new Set<string>([digits, withCountry, local]);
    if (local.length === 10) {
      variants.add(`${local.slice(0, 2)}9${local.slice(2)}`);
    }
    if (local.length === 11 && local[2] === '9') {
      variants.add(`${local.slice(0, 2)}${local.slice(3)}`);
    }

    return Array.from(variants).filter(Boolean);
  }

  private formatSchedulingOption(isoDate: string | undefined): string {
    if (!isoDate) return '—';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return '—';

    const datePart = date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    });
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const timePart = minutes === '00' ? `${hours}h` : `${hours}:${minutes}h`;

    return `${datePart} às ${timePart}`;
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
    } catch (err: any) {
      this.logger.warn(
        `Falha ao notificar médico sobre escolha de data do paciente (solicitação ${request.id}): ${err?.message}`,
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

    const phoneCandidates = this.normalizePhoneDigitsCandidates(params.from);
    if (phoneCandidates.length === 0) return false;

    const requestRepo = this.surgeryRequestRepository.getRepository();
    const request = await requestRepo
      .createQueryBuilder('sr')
      .innerJoinAndSelect('sr.patient', 'patient')
      .leftJoinAndSelect('sr.doctor', 'doctor')
      .where('sr.status = :status', {
        status: SurgeryRequestStatus.IN_SCHEDULING,
      })
      .andWhere(
        "regexp_replace(patient.phone, '[^0-9]', '', 'g') IN (:...phones)",
        { phones: phoneCandidates },
      )
      .orderBy('sr.updatedAt', 'DESC')
      .addOrderBy('sr.createdAt', 'DESC')
      .getOne();

    if (!request) {
      this.logger.warn(
        `Resposta de opção de agendamento sem solicitação correspondente (sid=${params.messageSid})`,
      );
      await this.whatsappService.sendMessage(
        params.from,
        'Não localizei uma solicitação em agendamento para esta resposta. Se precisar, fale com nossa equipe para reenviar as opções.',
      );
      return true;
    }

    const options = Array.isArray(request.dateOptions)
      ? request.dateOptions
      : [];
    const selectedIso = options[selectedIndex];
    if (!selectedIso) {
      await this.whatsappService.sendMessage(
        params.from,
        'Não encontrei essa opção de data para sua solicitação. Por favor, escolha uma das opções enviadas.',
      );
      return true;
    }

    await this.surgeryRequestRepository.update(request.id, {
      selectedDateIndex: selectedIndex,
    });

    const selectedLabel = this.formatSchedulingOption(selectedIso);
    await this.surgeryRequestActivityRepository.create({
      surgeryRequestId: request.id,
      userId: null,
      type: ActivityType.SYSTEM,
      content: `Paciente selecionou a ${selectedIndex + 1}ª opção de data (${selectedLabel}) no WhatsApp.`,
    });

    await this.notifyResponsibleDoctorOfSchedulingSelection(request as any);

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
    body: Record<string, any>,
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

    // Opt-out explícito é escape hatch APENAS de dev — nunca desliga em produção.
    if (explicitlyDisabled && nodeEnv !== 'production') return;

    if (!authToken) {
      // Sem token não há como validar. Em produção isso é erro de config e
      // precisa ser fail-closed: o webhook é @Public(), então "aceita qualquer
      // requisição" deixaria um atacante forjar o From e operar a plataforma
      // como o médico. Fora de produção, seguimos permitindo o dev local sem
      // Twilio configurado.
      if (nodeEnv === 'production') {
        throw new UnauthorizedException(
          'Configuração de webhook inválida: TWILIO_AUTH_TOKEN ausente',
        );
      }
      return;
    }

    // Token presente ⇒ valida SEMPRE, independente do NODE_ENV. Antes a
    // validação só ligava em `production` (ou com a flag), então um deploy em
    // `staging`/`NODE_ENV` diferente aceitava webhooks forjados mesmo tendo o
    // token. Defesa em profundidade: se dá para validar, valida.
    const isValid = urls.some((url) =>
      validateRequest(authToken, signature, url, body),
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }
  }
}
