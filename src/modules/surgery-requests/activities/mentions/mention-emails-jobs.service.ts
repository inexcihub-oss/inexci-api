import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bull';
import { getRequestContext } from 'src/shared/logging/request-context';

export const MENTION_EMAILS_QUEUE = 'mention-emails';
export const SEND_MENTION_EMAIL_JOB = 'send-mention-email';

export interface MentionEmailJobData {
  mentionId: string;
  surgeryRequestId: string;
  authorName: string;
  content: string;
  /** Correlation ID propagado para o processor (logging end-to-end). */
  requestId?: string;
}

/**
 * Produtor do e-mail de menção.
 *
 * O `delay` é o coração da regra combinada com o usuário: o e-mail só é
 * cobrado do sistema depois de N minutos, e quem decide se ele ainda faz
 * sentido é o worker, olhando se a notificação in-app foi lida nesse
 * intervalo.
 */
@Injectable()
export class MentionEmailsJobsService {
  private readonly logger = new Logger(MentionEmailsJobsService.name);

  constructor(
    @InjectQueue(MENTION_EMAILS_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  /** Nunca lança: a menção já está gravada e notificada in-app. */
  async schedule(data: MentionEmailJobData): Promise<void> {
    const minutos = Number(
      this.configService.get<number>('MENTION_EMAIL_DELAY_MINUTES', 10),
    );

    try {
      await this.queue.add(
        SEND_MENTION_EMAIL_JOB,
        {
          ...data,
          requestId: getRequestContext()?.requestId,
        } satisfies MentionEmailJobData,
        { delay: minutos * 60 * 1000 },
      );
    } catch (err: any) {
      this.logger.warn(
        `[MENCAO] Fila indisponível para o e-mail da menção ${data.mentionId}: ${err?.message}`,
      );
    }
  }
}
