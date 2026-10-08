import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatientNotificationSettings } from 'src/database/entities/patient-notification-settings.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { UpdatePatientNotificationSettingsDto } from './update-patient-notification-settings.dto';

/** Os avisos automáticos ao paciente que a conta pode desligar. */
export type AvisoAoPaciente =
  | 'appointmentScheduled'
  | 'appointmentReminder'
  | 'appointmentCancelled';

export type PatientNotificationSettingsView = Record<AvisoAoPaciente, boolean>;

const AVISOS: AvisoAoPaciente[] = [
  'appointmentScheduled',
  'appointmentReminder',
  'appointmentCancelled',
];

/**
 * Liga/desliga, por conta, os avisos automáticos ao paciente. Conta sem linha
 * gravada tem tudo ligado — o comportamento de antes da configuração existir.
 */
@Injectable()
export class PatientNotificationSettingsService {
  constructor(
    @InjectRepository(PatientNotificationSettings)
    private readonly repository: Repository<PatientNotificationSettings>,
    private readonly accessControlService: AccessControlService,
  ) {}

  async getForUser(userId: string): Promise<PatientNotificationSettingsView> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    return this.get(ownerId);
  }

  async updateForUser(
    userId: string,
    data: UpdatePatientNotificationSettingsDto,
  ): Promise<PatientNotificationSettingsView> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const alterados: Partial<PatientNotificationSettingsView> = {};
    for (const aviso of AVISOS) {
      if (typeof data[aviso] === 'boolean') alterados[aviso] = data[aviso];
    }
    if (Object.keys(alterados).length > 0) {
      await this.repository.upsert({ ownerId, ...alterados }, ['ownerId']);
    }

    return this.get(ownerId);
  }

  async get(ownerId: string): Promise<PatientNotificationSettingsView> {
    const salvo = await this.repository.findOne({ where: { ownerId } });
    return {
      appointmentScheduled: salvo?.appointmentScheduled ?? true,
      appointmentReminder: salvo?.appointmentReminder ?? true,
      appointmentCancelled: salvo?.appointmentCancelled ?? true,
    };
  }

  /**
   * O aviso está ligado para a conta? Erro de leitura sobe: quem chama decide
   * (o lembrete retenta na hora seguinte; agendamento/cancelamento são
   * best-effort e não avisam). Nunca envia "no escuro" um aviso que a conta
   * pode ter desligado.
   */
  async isEnabled(ownerId: string, aviso: AvisoAoPaciente): Promise<boolean> {
    const salvo = await this.repository.findOne({ where: { ownerId } });
    return salvo?.[aviso] ?? true;
  }
}
