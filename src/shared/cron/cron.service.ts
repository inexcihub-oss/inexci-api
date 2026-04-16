import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { SurgeryRequestsService } from 'src/modules/surgery-requests/surgery-requests.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class CronService {
  private readonly dashboardUrl: string;

  constructor(
    private readonly surgeryRequestsService: SurgeryRequestsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {
    this.dashboardUrl = this.configService.get<string>('DASHBOARD_URL');
  }

  @Cron('0 0 7 * * *')
  async handleCronEmail() {
    const resp = await this.surgeryRequestsService.dateExpired();

    resp.forEach((surgeryRequest) => {
      this.emailService.send(
        surgeryRequest.patient.email,
        'Acompanhamento da sua solicitação',
        `
          <p>Olá, <strong>${surgeryRequest.patient.name}</strong></p>
          <p>Gostaríamos de informar que já se passaram 21 dias desde que a sua solicitação entrou em análise.</p>
          <p>Caso você já tenha acionado o convênio para registrar uma reclamação, é possível incluir essa informação em nossa plataforma. Dessa forma, nossa equipe poderá acompanhar todas as ações tomadas e garantir uma resolução mais ágil para o seu caso.</p>
          <p>Para inserir os detalhes da reclamação, <a href='${this.dashboardUrl}'>Clique aqui</a> para acessar a plataforma. </p>
          <br />
          <br />
          <p>Não consegue clicar no link? Utilize o link abaixo:<br /> ${this.dashboardUrl}</p>
        `,
      );
    });
  }
}
