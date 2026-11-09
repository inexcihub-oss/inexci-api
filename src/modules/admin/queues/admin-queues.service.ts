import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Job, Queue } from 'bull';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import { AdminLookupRepository } from 'src/database/repositories/admin-lookup.repository';
import { maskSensitiveText } from 'src/shared/utils/mask.util';
import { errorMessage } from 'src/shared/utils/error-message.util';
import { PlatformAuditService } from '../audit/platform-audit.service';
import {
  ADMIN_QUEUES,
  AdminQueueName,
  isAdminQueueName,
} from './admin-queues.catalog';
import {
  AdminFailedJobDto,
  AdminFailedJobsResponseDto,
  AdminQueueJobActionResultDto,
  AdminQueuesOverviewDto,
} from './dto/admin-queues.dto';

export const FILAS_INDISPONIVEIS =
  'Não foi possível ler as filas agora. Tente novamente em instantes.';
export const TAREFA_NAO_ENCONTRADA =
  'Tarefa não encontrada. Ela pode já ter sido repetida ou removida.';
export const TAREFA_SEM_FALHA = 'Só tarefas com falha podem ser alteradas.';

const REDIS_TIMEOUT_MS = 3000;
const ERROR_MAX_LENGTH = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JobAction = 'retry' | 'discard';

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function jobData(job: Job): Record<string, unknown> {
  return job.data && typeof job.data === 'object'
    ? (job.data as Record<string, unknown>)
    : {};
}

function toDate(ms: number | undefined | null): Date | null {
  return typeof ms === 'number' && ms > 0 ? new Date(ms) : null;
}

@Injectable()
export class AdminQueuesService {
  private readonly queues: Map<AdminQueueName, Queue>;

  constructor(
    @InjectQueue('mail') mail: Queue,
    @InjectQueue('whatsapp-messages') whatsapp: Queue,
    @InjectQueue('pdf-generation') pdf: Queue,
    @InjectQueue('ai-messages') ai: Queue,
    @InjectQueue('document-extraction') documents: Queue,
    @InjectQueue('indication-documents') indication: Queue,
    @InjectQueue('mention-emails') mentions: Queue,
    private readonly lookup: AdminLookupRepository,
    private readonly audit: PlatformAuditService,
  ) {
    this.queues = new Map<AdminQueueName, Queue>([
      ['mail', mail],
      ['whatsapp-messages', whatsapp],
      ['pdf-generation', pdf],
      ['ai-messages', ai],
      ['document-extraction', documents],
      ['indication-documents', indication],
      ['mention-emails', mentions],
    ]);
  }

  async overview(): Promise<AdminQueuesOverviewDto> {
    const queues = await this.withRedis(() =>
      Promise.all(
        ADMIN_QUEUES.map(async (meta) => {
          const queue = this.queueOf(meta.name);
          const [counts, paused] = await Promise.all([
            queue.getJobCounts(),
            queue.isPaused(),
          ]);
          return {
            name: meta.name,
            label: meta.label,
            description: meta.description,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
            paused,
          };
        }),
      ),
    );
    return { queues, checkedAt: new Date() };
  }

  async listFailed(params: {
    queue?: string;
    limit: number;
    offset: number;
  }): Promise<AdminFailedJobsResponseDto> {
    const names = params.queue
      ? [this.validName(params.queue)]
      : ADMIN_QUEUES.map((q) => q.name);
    const end = params.offset + params.limit - 1;

    const { jobs, total } = await this.withRedis(async () => {
      const perQueue = await Promise.all(
        names.map(async (name) => {
          const queue = this.queueOf(name);
          const [failed, count] = await Promise.all([
            names.length === 1
              ? queue.getFailed(params.offset, end)
              : queue.getFailed(0, end),
            queue.getFailedCount(),
          ]);
          return {
            jobs: failed
              .filter((job): job is Job => Boolean(job))
              .map((job) => ({ name, job })),
            count,
          };
        }),
      );
      const merged = perQueue
        .flatMap((q) => q.jobs)
        .sort((a, b) => (b.job.finishedOn ?? 0) - (a.job.finishedOn ?? 0));
      return {
        jobs:
          names.length === 1
            ? merged
            : merged.slice(params.offset, params.offset + params.limit),
        total: perQueue.reduce((sum, q) => sum + q.count, 0),
      };
    });

    return { items: await this.summarize(jobs), total };
  }

  retry(
    queue: string,
    jobId: string,
    reason: string,
    actorAdminId: string,
  ): Promise<AdminQueueJobActionResultDto> {
    return this.act('retry', queue, jobId, reason, actorAdminId);
  }

  discard(
    queue: string,
    jobId: string,
    reason: string,
    actorAdminId: string,
  ): Promise<AdminQueueJobActionResultDto> {
    return this.act('discard', queue, jobId, reason, actorAdminId);
  }

  private async act(
    action: JobAction,
    queueName: string,
    jobId: string,
    reason: string,
    actorAdminId: string,
  ): Promise<AdminQueueJobActionResultDto> {
    const name = this.validName(queueName);
    const queue = this.queueOf(name);
    const job = await this.withRedis(() => queue.getJob(jobId));
    if (!job) throw new NotFoundException(TAREFA_NAO_ENCONTRADA);
    const failed = await this.withRedis(() => job.isFailed());
    if (!failed) throw new ConflictException(TAREFA_SEM_FALHA);

    const [summary] = await this.summarize([{ name, job }]);
    const entry = await this.audit.begin({
      actorAdminId,
      action:
        action === 'retry'
          ? PlatformAuditAction.QUEUE_JOB_RETRIED
          : PlatformAuditAction.QUEUE_JOB_DISCARDED,
      targetOwnerId: summary.ownerId,
      reason,
      before: {
        queue: name,
        jobId: summary.id,
        name: summary.name,
        attemptsMade: summary.attemptsMade,
        error: summary.error,
      },
    });

    let original: unknown = null;
    try {
      await this.withRedis(async () => {
        try {
          await (action === 'retry' ? job.retry() : job.remove());
        } catch (err) {
          original = err;
          throw err;
        }
      });
    } catch (err) {
      await this.audit.fail(
        entry.id,
        maskSensitiveText(errorMessage(original ?? err)).slice(0, 500),
      );
      throw err;
    }
    await this.audit.succeed(entry.id, {
      after: { queue: name, jobId: summary.id, action },
    });
    return { auditLogId: entry.id, queue: name, jobId: summary.id };
  }

  private async summarize(
    jobs: Array<{ name: AdminQueueName; job: Job }>,
  ): Promise<AdminFailedJobDto[]> {
    const directOwner = jobs.map(({ job }) => {
      const data = jobData(job);
      return uuidOrNull(data.tenantId) ?? uuidOrNull(data.ownerId);
    });
    const userIds = jobs
      .map(({ job }, i) =>
        directOwner[i] ? null : uuidOrNull(jobData(job).userId),
      )
      .filter((id): id is string => Boolean(id));
    const owners = await this.lookup.ownersOfUsers(userIds);
    const ownerIds = jobs.map(({ job }, i) => {
      if (directOwner[i]) return directOwner[i];
      const userId = uuidOrNull(jobData(job).userId);
      return userId ? (owners.get(userId) ?? null) : null;
    });
    const names = await this.lookup.accountNames(
      ownerIds.filter((id): id is string => Boolean(id)),
    );

    return jobs.map(({ name, job }, i) => {
      const meta = ADMIN_QUEUES.find((q) => q.name === name);
      const ownerId = ownerIds[i];
      const attempts = job.opts?.attempts;
      return {
        id: String(job.id),
        queue: name,
        queueLabel: meta?.label ?? name,
        name: job.name,
        ownerId,
        ownerName: ownerId ? (names.get(ownerId) ?? null) : null,
        attemptsMade: job.attemptsMade ?? 0,
        maxAttempts: typeof attempts === 'number' ? attempts : null,
        error: job.failedReason
          ? maskSensitiveText(job.failedReason).slice(0, ERROR_MAX_LENGTH)
          : null,
        createdAt: toDate(job.timestamp),
        failedAt: toDate(job.finishedOn),
      };
    });
  }

  private validName(value: string): AdminQueueName {
    if (!isAdminQueueName(value)) {
      throw new NotFoundException('Fila não encontrada.');
    }
    return value;
  }

  private queueOf(name: AdminQueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new NotFoundException('Fila não encontrada.');
    return queue;
  }

  private async withRedis<T>(fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ServiceUnavailableException(FILAS_INDISPONIVEIS)),
        REDIS_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([fn(), timeout]);
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      throw new ServiceUnavailableException(FILAS_INDISPONIVEIS);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
