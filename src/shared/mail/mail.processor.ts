import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Job } from 'bull';
import * as nodemailer from 'nodemailer';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import * as fs from 'fs';
import { mailConfig } from 'src/config/mail.config';
import { MailJobData } from './mail.service';

@Processor('mail')
export class MailProcessor {
  private readonly logger = new Logger(MailProcessor.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    @Inject(mailConfig.KEY)
    private readonly mail: ConfigType<typeof mailConfig>,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.mail.host,
      port: this.mail.port,
      secure: this.mail.secure,
      auth: {
        user: this.mail.auth.user,
        pass: this.mail.auth.pass,
      },
    });
  }

  @Process('send-mail')
  async handleSendMail(job: Job<MailJobData>) {
    const { template, to, subject, context } = job.data;

    try {
      const html = this.renderTemplate(template, context);

      await this.transporter.sendMail({
        from: `"${this.mail.from.name}" <${this.mail.from.address}>`,
        to,
        subject,
        html,
      });

      this.logger.log(`E-mail enviado: template="${template}" to="${to}"`);
    } catch (error) {
      // Loga o erro mas não relança — evita retries infinitos quando
      // SMTP não está configurado ou serviço de e-mail está indisponível
      this.logger.warn(
        `Falha ao enviar e-mail (SMTP indisponível?): template="${template}" to="${to}"`,
        error,
      );
    }
  }

  private renderTemplate(
    templateName: string,
    context: Record<string, any>,
  ): string {
    const templatePath = path.join(
      __dirname,
      'templates',
      `${templateName}.hbs`,
    );

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template de e-mail não encontrado: ${templateName}`);
    }

    const source = fs.readFileSync(templatePath, 'utf-8');
    const compiled = Handlebars.compile(source);
    return compiled(context);
  }
}
