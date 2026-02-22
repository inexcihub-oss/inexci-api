import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
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

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.secure,
      auth: {
        user: mailConfig.auth.user,
        pass: mailConfig.auth.pass,
      },
    });
  }

  @Process('send-mail')
  async handleSendMail(job: Job<MailJobData>) {
    const { template, to, subject, context } = job.data;

    try {
      const html = this.renderTemplate(template, context);

      await this.transporter.sendMail({
        from: `"${mailConfig.from.name}" <${mailConfig.from.address}>`,
        to,
        subject,
        html,
      });

      this.logger.log(`E-mail enviado: template="${template}" to="${to}"`);
    } catch (error) {
      this.logger.error(
        `Erro ao enviar e-mail: template="${template}" to="${to}"`,
        error,
      );
      throw error; // Bull vai tentar novamente conforme a config de attempts
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
