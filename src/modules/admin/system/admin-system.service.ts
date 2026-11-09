import { ConflictException, Injectable } from '@nestjs/common';
import { errorMessage } from 'src/shared/utils/error-message.util';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { DistributedLockService } from 'src/shared/locks/distributed-lock.service';
import { SystemJobDto } from './dto/system-jobs.dto';
import {
  SYSTEM_JOBS,
  SystemJobKey,
  systemJob,
  systemJobLockKey,
} from './system-jobs';

export const TAREFA_EM_EXECUCAO =
  'Esta tarefa já está em execução. Aguarde o término e tente novamente.';

@Injectable()
export class AdminSystemService {
  constructor(
    private readonly audit: PlatformAuditService,
    private readonly jobLock: DistributedLockService,
  ) {}

  async listJobs(): Promise<SystemJobDto[]> {
    const ultimas = await this.audit.lastSucceeded(
      SYSTEM_JOBS.map((job) => job.action),
    );
    return SYSTEM_JOBS.map((job) => {
      const ultima = ultimas.get(job.action);
      return {
        key: job.key,
        name: job.name,
        description: job.description,
        schedule: job.schedule,
        lastManualRun: ultima
          ? { at: ultima.at, by: ultima.by, result: ultima.result }
          : null,
      };
    });
  }

  async runManual<T extends Record<string, unknown>>(
    key: SystemJobKey,
    input: { reason: string; actorAdminId: string },
    executar: () => Promise<T>,
  ): Promise<T> {
    const job = systemJob(key);
    const lockKey = systemJobLockKey(key);
    const trava = await this.jobLock.acquire(lockKey);
    if (!trava) throw new ConflictException(TAREFA_EM_EXECUCAO);

    try {
      const entry = await this.audit.begin({
        actorAdminId: input.actorAdminId,
        action: job.action,
        reason: input.reason,
      });
      try {
        const result = await executar();
        await this.audit.succeed(entry.id, { after: result });
        return result;
      } catch (err) {
        await this.audit.fail(entry.id, errorMessage(err).slice(0, 500));
        throw err;
      }
    } finally {
      await this.jobLock.release(lockKey, trava);
    }
  }
}
