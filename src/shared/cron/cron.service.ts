import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SurgeryRequestsService } from 'src/modules/surgery-requests/surgery-requests.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class CronService {
  constructor(
    private readonly surgeryRequestsService: SurgeryRequestsService,
    private readonly emailService: EmailService,
  ) {}

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
          <p>Para inserir os detalhes da reclamação, <a href='${process.env.DASHBOARD_URL}'>Clique aqui</a> para acessar a plataforma. </p>
          <br />
          <br />
          <p>Não consegue clicar no link? Utilize o link abaixo:<br /> ${process.env.DASHBOARD_URL}</p>
        `,
      );
    });
  }
}
