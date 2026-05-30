import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateRequest } from 'twilio';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from 'src/database/repositories/surgery-request-activity.repository';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { WHATSAPP_TEMPLATES } from 'src/shared/whatsapp/whatsapp-templates.constants';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  private static readonly SCHEDULING_PATIENT_SELECTED_STATUS_LABEL =
    'Em agendamento';

  private static readonly SCHEDULING_PATIENT_SELECTED_NEXT_STEP =
    'Paciente escolheu uma opção de data para a cirurgia. Confirme a data da cirurgia';

  constructor(
    private readonly configService: ConfigService,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly surgeryRequestActivityRepository: SurgeryRequestActivityRepository,
    private readonly whatsappService: WhatsappService,
  ) {}

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
    const validateSignatureRaw = this.configService.get<string>(
      'TWILIO_VALIDATE_SIGNATURE',
      '',
    );
    const shouldValidateSignature =
      validateSignatureRaw.trim().toLowerCase() === 'true' ||
      validateSignatureRaw.trim() === '1' ||
      nodeEnv === 'production';

    if (!shouldValidateSignature) return;

    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN', '');
    if (!authToken) return; // Em dev sem auth token configurado, pula validação

    const isValid = urls.some((url) =>
      validateRequest(authToken, signature, url, body),
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }
  }
}
