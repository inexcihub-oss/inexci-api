import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SurgeryRequestDocumentExtractionJobsService } from './surgery-request-document-extraction-jobs.service';

class FakeRedis {
  status = 'ready';
  private readonly store = new Map<string, string>();

  connect = jest.fn().mockResolvedValue(undefined);
  disconnect = jest.fn();

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  clear(): void {
    this.store.clear();
  }
}

const fakeRedis = new FakeRedis();

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => fakeRedis),
  };
});

describe('SurgeryRequestDocumentExtractionJobsService', () => {
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let config: ConfigService;
  let notificationsGateway: { emitDocumentExtractionStatus: jest.Mock };
  let service: SurgeryRequestDocumentExtractionJobsService;

  beforeEach(() => {
    fakeRedis.clear();
    queue = {
      add: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn().mockResolvedValue(null),
    };

    config = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'AI_DOC_SC_EXTRACT_JOB_TTL_SECONDS') return 1200;
        if (key === 'AI_DOC_MAX_BYTES') return 10 * 1024 * 1024;
        if (key === 'REDIS_HOST') return 'localhost';
        if (key === 'REDIS_PORT') return 6379;
        return defaultValue;
      }),
    } as any;

    notificationsGateway = {
      emitDocumentExtractionStatus: jest.fn(),
    };

    service = new SurgeryRequestDocumentExtractionJobsService(
      queue as any,
      config,
      notificationsGateway as any,
    );
  });

  it('enfileira job e retorna jobId + status processing', async () => {
    const response = await service.enqueue(
      {
        originalname: 'laudo.pdf',
        mimetype: 'application/pdf',
        size: 1024,
        buffer: Buffer.from('pdf-content'),
      } as Express.Multer.File,
      'user-1',
    );

    expect(response.status).toBe('processing');
    expect(response.jobId).toBeTruthy();
    expect(queue.add).toHaveBeenCalledWith(
      'extract-from-document',
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
  });

  it('retorna status done quando já existe resultado persistido', async () => {
    await service.markDone('job-1', 'user-1', {
      kind: 'medical_report',
      confidence: 0.9,
      extracted: {},
      suggestedDocumentType: 'medical_report',
      patientCpfMissing: false,
      patientMatchedByCpf: false,
      candidates: {
        patient: [],
        hospital: [],
        healthPlan: [],
        procedure: [],
      },
      tempStoragePath: 'tmp/doc.pdf',
    } as any);

    const status = await service.getStatus('job-1', 'user-1');
    expect(status.status).toBe('done');
    if (status.status === 'done') {
      expect(status.result.tempStoragePath).toBe('tmp/doc.pdf');
    }

    expect(
      notificationsGateway.emitDocumentExtractionStatus,
    ).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        jobId: 'job-1',
        status: 'done',
      }),
    );
  });

  it('bloqueia leitura de status para usuário diferente', async () => {
    await service.markProcessing('job-2', 'owner-user');

    await expect(service.getStatus('job-2', 'other-user')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('retorna processing pelo fallback da fila quando estado não existe no Redis', async () => {
    queue.getJob.mockResolvedValueOnce({
      data: { userId: 'user-1' },
      isFailed: jest.fn().mockResolvedValue(false),
    });

    const status = await service.getStatus('missing-job', 'user-1');
    expect(status).toEqual({ status: 'processing' });
  });
});
