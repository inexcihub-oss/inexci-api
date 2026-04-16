import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Brevo from '@getbrevo/brevo';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class EmailService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async send(email: string, subject: string, message) {
    try {
      const apiInstance = new Brevo.TransactionalEmailsApi();
      apiInstance.setApiKey(0, this.configService.get<string>('BREVO_API_KEY'));

      await apiInstance.sendTransacEmail({
        to: [{ email }],
        subject,
        htmlContent: message,
        sender: { name: 'Inexci', email: 'noreply@inexci.com.br' },
      });

      return {};
    } catch (error) {
      return false;
    }
  }

  async sendCompleteRegisterEmail(
    email: string,
    user: { id: string; name: string },
    isPatient?: boolean,
  ) {
    try {
      const token = this.jwtService.sign(
        { userId: user.id },
        { secret: this.configService.get<string>('JWT_SECRET'), expiresIn: '1y' },
      );
      const dashboardUrl = this.configService.get<string>('DASHBOARD_URL');
      const link = `${dashboardUrl}/completeRegister?token=${token}`;

      await this.send(
        email,
        'Bem-vindo a Inexci!',
        isPatient
          ? `
          <p>Olá, <strong>${user.name}</strong></p>
          <p>A sua cirurgia foi solicitada junto ao hospital. <a href='${link}'>Clique aqui</a> para completar seu cadastro e acompanhar a evolução da sua solicitação cirúrgica.</p>
          <br />
          <br />
          <p>Não consegue clicar no link? Utilize o link abaixo:<br /> ${link}</p>
        `
          : `
          <p>Olá, <strong>${user.name}</strong></p>
          <p>Você foi convidado a fazer parte do Inexci. <a href='${link}'>Clique aqui</a> para ir para a plataforma e completar seu cadastr.</p>
          <br />
          <br />
          <p>Não consegue clicar no link? Utilize o link abaixo:<br /> ${link}</p>
        `,
      );
      return true;
    } catch (error) {
      return false;
    }
  }
}
