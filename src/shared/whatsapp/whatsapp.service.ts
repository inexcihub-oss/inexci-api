import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bull';

export interface WhatsappJobData {
  to: string;
  body: string;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    @InjectQueue('whatsapp-messages')
    private readonly whatsappQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Enfileira uma mensagem WhatsApp para envio assíncrono via Bull queue.
   * Falhas não propagam exceção para não bloquear o fluxo principal.
   */
  async sendMessage(to: string, body: string): Promise<void> {
    try {
      await this.whatsappQueue.add(
        'send-whatsapp',
        { to, body } satisfies WhatsappJobData,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`Mensagem WhatsApp enfileirada para: ${to}`);
    } catch (err: any) {
      this.logger.warn(
        `Falha ao enfileirar mensagem WhatsApp (Redis offline?): to="${to}" — ${err?.message}`,
      );
    }
  }

  /**
   * Envia mensagem de boas-vindas ao paciente recém-cadastrado.
   */
  async sendPatientWelcome(to: string, patientName: string): Promise<void> {
    const body =
      `Olá, ${patientName}! 👋\n\n` +
      `Você foi cadastrado na plataforma *Inexci*. ` +
      `O WhatsApp será o canal oficial de comunicação para acompanhamento dos seus procedimentos cirúrgicos.\n\n` +
      `Em caso de dúvidas, entre em contato com seu médico responsável.`;
    return this.sendMessage(to, body);
  }

  /**
   * Envia mensagem de boas-vindas ao médico recém-cadastrado.
   */
  async sendDoctorWelcome(
    to: string,
    doctorName: string,
    email: string,
  ): Promise<void> {
    const dashboardUrl = this.configService.get<string>('DASHBOARD_URL');
    const body =
      `Olá, Dr(a). ${doctorName}! 👨‍⚕️\n\n` +
      `Sua conta na plataforma *Inexci* foi criada com sucesso. ` +
      `Acesse a plataforma pelo link abaixo para começar a gerenciar suas solicitações cirúrgicas:\n\n` +
      `🔗 ${dashboardUrl}\n\n` +
      `Seu login é: *${email}*\n\n` +
      `Qualquer dúvida, nossa equipe de suporte está à disposição.`;
    return this.sendMessage(to, body);
  }
}
