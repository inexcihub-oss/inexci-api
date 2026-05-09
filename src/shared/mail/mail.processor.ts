import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

@Injectable()
@Processor('mail')
export class MailProcessor implements OnModuleInit {
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
  }

  async onModuleInit() {
    await this.registerPartials();
  }

  /**
   * Em dev (ts-node) `__dirname` é `src/shared/mail/`. Após `nest build`, o JS
   * compilado pode acabar em `dist/src/shared/mail/` (porque o tsc adota
   * `rootDir: "."` ao detectar a pasta `scripts/` ao lado de `src/`), enquanto
   * os assets `.hbs` são copiados para `dist/shared/mail/templates/`. Para
   * sobreviver aos dois layouts, procuramos os templates em vários candidatos.
   */
  private resolveTemplatesDir(): string[] {
    return [
      path.join(__dirname, 'templates'),
      path.join(__dirname, '..', '..', '..', 'shared', 'mail', 'templates'),
      path.join(process.cwd(), 'src', 'shared', 'mail', 'templates'),
      path.join(process.cwd(), 'dist', 'shared', 'mail', 'templates'),
    ];
  }

  private async findTemplatePath(filename: string): Promise<string | null> {
    for (const dir of this.resolveTemplatesDir()) {
      const candidate = path.join(dir, filename);
      try {
        await fs.promises.access(candidate);
        return candidate;
      } catch {
        // tenta próximo candidato
      }
    }
    return null;
  }

  private async registerPartials() {
    for (const baseDir of this.resolveTemplatesDir()) {
      const partialsDir = path.join(baseDir, 'partials');
      try {
        await fs.promises.access(partialsDir);
      } catch {
        continue;
      }

      const files = await fs.promises.readdir(partialsDir);
      await Promise.all(
        files
          .filter((f) => f.endsWith('.hbs'))
          .map(async (file) => {
            const name = file.replace('.hbs', '');
            const source = await fs.promises.readFile(
              path.join(partialsDir, file),
              'utf-8',
            );
            Handlebars.registerPartial(name, source);
            this.logger.log(`Handlebars partial registrado: ${name}`);
          }),
      );
      return;
    }
  }

  @Process('send-mail')
  async handleSendMail(job: Job<MailJobData>) {
    const {
      template,
      html: rawHtml,
      to,
      subject,
      context,
      attachments,
    } = job.data;

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
      const html =
        rawHtml ?? (await this.renderTemplate(template, context ?? {}));

      await this.transporter.sendMail({
        from: `"${this.mail.from.name}" <${this.mail.from.address}>`,
        to,
        subject,
        html,
        attachments: attachments?.map((a) => {
          let content: Buffer | string;
          if (Buffer.isBuffer(a.content)) {
            content = a.content;
          } else if (typeof a.content === 'string') {
            content = Buffer.from(a.content, 'base64');
          } else {
            // Bull serializa Buffer como { type: 'Buffer', data: [...] } via JSON/Redis
            const raw = a.content as any;
            content = Buffer.from(raw.data ?? raw);
          }
          return {
            filename: a.filename,
            content,
            contentType: a.contentType ?? 'application/pdf',
          };
        }),
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

  private async renderTemplate(
    templateName: string,
    context: Record<string, any>,
  ): Promise<string> {
    const templatePath = await this.findTemplatePath(`${templateName}.hbs`);
    if (!templatePath) {
      throw new Error(`Template de e-mail não encontrado: ${templateName}`);
    }

    const enrichedContext = {
      logoUrl: this.mail.appUrl
        ? `${this.mail.appUrl}/brand/logo-dark.png`
        : null,
      ...context,
    };

    const source = await fs.promises.readFile(templatePath, 'utf-8');
    const compiled = Handlebars.compile(source);
    return compiled(enrichedContext);
  }

  @OnQueueFailed()
  handleFailedJob(job: Job<MailJobData>, error: Error) {
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
