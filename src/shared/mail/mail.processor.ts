import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import * as nodemailer from 'nodemailer';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import * as fs from 'fs';
import { mailConfig } from 'src/config/mail.config';
import { MailJobData } from './mail.service';
import {
  NotificationSendLog,
  NotificationChannel,
  NotificationSendStatus,
} from 'src/database/entities/notification-send-log.entity';

@Processor('mail')
export class MailProcessor {
  private readonly logger = new Logger(MailProcessor.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    @Inject(mailConfig.KEY)
    private readonly mail: ConfigType<typeof mailConfig>,
    @InjectRepository(NotificationSendLog)
    private readonly sendLogRepository: Repository<NotificationSendLog>,
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

    // Registrar partials Handlebars
    this.registerPartials();
  }

  private registerPartials() {
    const partialsDir = path.join(__dirname, 'templates', 'partials');
    if (!fs.existsSync(partialsDir)) return;

    fs.readdirSync(partialsDir)
      .filter((f) => f.endsWith('.hbs'))
      .forEach((file) => {
        const name = file.replace('.hbs', '');
        const source = fs.readFileSync(path.join(partialsDir, file), 'utf-8');
        Handlebars.registerPartial(name, source);
        this.logger.log(`Handlebars partial registrado: ${name}`);
      });
  }

  @Process('send-mail')
  async handleSendMail(job: Job<MailJobData>) {
    const { template, html: rawHtml, to, subject, context } = job.data;

    const sendLog = this.sendLogRepository.create({
      channel: NotificationChannel.EMAIL,
      status: NotificationSendStatus.QUEUED,
      to,
      subject,
      template: template ?? 'raw_html',
      job_id: String(job.id),
      attempts: job.attemptsMade,
    });

    try {
      const html = rawHtml ?? this.renderTemplate(template, context ?? {});

      await this.transporter.sendMail({
        from: `"${this.mail.from.name}" <${this.mail.from.address}>`,
        to,
        subject,
        html,
      });

      sendLog.status = NotificationSendStatus.SENT;
      sendLog.sent_at = new Date();
      sendLog.attempts = job.attemptsMade + 1;

      this.logger.log(
        JSON.stringify({
          event: 'email_sent',
          template: template ?? 'raw_html',
          to,
          subject,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
        }),
      );
    } catch (error) {
      sendLog.status = NotificationSendStatus.FAILED;
      sendLog.error_message =
        error instanceof Error ? error.message : String(error);
      sendLog.attempts = job.attemptsMade + 1;

      this.logger.warn(
        JSON.stringify({
          event: 'email_failed',
          template: template ?? 'raw_html',
          to,
          subject,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      try {
        await this.sendLogRepository.save(sendLog);
      } catch (logErr: any) {
        this.logger.error(
          `Falha ao salvar send log de email: ${logErr?.message}`,
        );
      }
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

  @OnQueueFailed()
  async handleFailedJob(job: Job<MailJobData>, error: Error) {
    const maxAttempts = job.opts?.attempts ?? 3;
    if (job.attemptsMade >= maxAttempts) {
      this.logger.error(
        JSON.stringify({
          event: 'email_dead_letter',
          template: job.data.template ?? 'raw_html',
          to: job.data.to,
          subject: job.data.subject,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
          error: error.message,
        }),
      );
    }
  }
}
