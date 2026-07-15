import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bull';
import IORedis from 'ioredis';
import { v4 as uuid } from 'uuid';
import { ExtractFromDocumentResponseDto } from '../dto/extract-from-document-response.dto';
import {
  ExtractFromDocumentJobStatusResponseDto,
  ExtractFromDocumentQueuedResponseDto,
} from '../dto/extract-from-document-job.dto';
import { NotificationsGateway } from 'src/modules/notifications/notifications.gateway';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { NotificationType } from 'src/database/entities/notification.entity';
import { getRequestContext } from 'src/shared/logging/request-context';

const DOCUMENT_EXTRACTION_QUEUE = 'document-extraction';
const DOCUMENT_EXTRACTION_JOB = 'extract-from-document';
const REDIS_KEY_PREFIX = 'sc:doc-extraction:';
const DEFAULT_STATUS_TTL_SECONDS = 20 * 60;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const FRIENDLY_ERROR_MESSAGE =
  'Não foi possível processar o documento. Tente novamente.';
const EXPIRED_ERROR_MESSAGE =
  'Não encontramos o resultado deste processamento. Envie o documento novamente.';
const DOCUMENT_EXTRACTION_LINK_BASE = '/solicitacoes-cirurgicas';

export interface DocumentExtractionJobData {
  userId: string;
  file: {
    originalname: string;
    mimetype: string;
    size: number;
    bufferBase64: string;
  };
  /** Correlation ID propagado para o processor (logging end-to-end). */
  requestId?: string;
}

export interface DocumentExtractionStatusEvent {
  jobId: string;
  status: 'processing' | 'done' | 'error';
  result?: ExtractFromDocumentResponseDto;
  message?: string;
}

interface StoredDocumentExtractionState {
  userId: string;
  status: 'processing' | 'done' | 'error';
  result?: ExtractFromDocumentResponseDto;
  message?: string;
  updatedAt: string;
}

@Injectable()
export class SurgeryRequestDocumentExtractionJobsService implements OnModuleDestroy {
  private readonly logger = new Logger(
    SurgeryRequestDocumentExtractionJobsService.name,
  );
  private redis: IORedis | null = null;

  constructor(
    @InjectQueue(DOCUMENT_EXTRACTION_QUEUE)
    private readonly documentExtractionQueue: Queue,
    private readonly configService: ConfigService,
    @Optional()
    private readonly notificationsGateway?: NotificationsGateway,
    @Optional()
    private readonly notificationsService?: NotificationsService,
  ) {
    this.redis = this.createRedisClient();
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  async enqueue(
    file: Express.Multer.File,
    userId: string,
  ): Promise<ExtractFromDocumentQueuedResponseDto> {
    this.assertFileSize(file);

    const jobId = uuid();
    await this.setState(jobId, {
      userId,
      status: 'processing',
      updatedAt: new Date().toISOString(),
    });

    try {
      await this.documentExtractionQueue.add(
        DOCUMENT_EXTRACTION_JOB,
        {
          userId,
          file: {
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            bufferBase64: file.buffer.toString('base64'),
          },
          requestId: getRequestContext()?.requestId,
        } satisfies DocumentExtractionJobData,
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (err: any) {
      await this.deleteState(jobId);
      this.logger.warn(
        `Falha ao enfileirar extração de documento (userId=${userId}): ${err?.message}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível iniciar o processamento do documento no momento. Tente novamente.',
      );
    }

    return { jobId, status: 'processing' };
  }

  async getStatus(
    jobId: string,
    userId: string,
  ): Promise<ExtractFromDocumentJobStatusResponseDto> {
    const state = await this.getState(jobId);
    if (state) {
      this.assertJobOwnership(state.userId, userId);
      if (state.status === 'done' && state.result) {
        return { status: 'done', result: state.result };
      }
      if (state.status === 'error') {
        return {
          status: 'error',
          message: state.message || FRIENDLY_ERROR_MESSAGE,
        };
      }
      return { status: 'processing' };
    }

    const job = await this.documentExtractionQueue.getJob(jobId);
    if (!job) {
      return { status: 'error', message: EXPIRED_ERROR_MESSAGE };
    }

    this.assertJobOwnership(job.data?.userId, userId);

    if (await job.isFailed()) {
      return { status: 'error', message: FRIENDLY_ERROR_MESSAGE };
    }

    return { status: 'processing' };
  }

  async markProcessing(jobId: string, userId: string): Promise<void> {
    await this.setState(jobId, {
      userId,
      status: 'processing',
      updatedAt: new Date().toISOString(),
    });
    this.emitStatus(userId, { jobId, status: 'processing' });
  }

  async markDone(
    jobId: string,
    userId: string,
    result: ExtractFromDocumentResponseDto,
    documentName?: string,
  ): Promise<void> {
    await this.setState(jobId, {
      userId,
      status: 'done',
      result,
      updatedAt: new Date().toISOString(),
    });
    this.emitStatus(userId, { jobId, status: 'done', result });
    await this.notifyBackgroundDone(userId, jobId, documentName);
  }

  async markError(
    jobId: string,
    userId: string,
    message = FRIENDLY_ERROR_MESSAGE,
    documentName?: string,
  ): Promise<void> {
    await this.setState(jobId, {
      userId,
      status: 'error',
      message,
      updatedAt: new Date().toISOString(),
    });
    this.emitStatus(userId, { jobId, status: 'error', message });
    await this.notifyBackgroundError(userId, jobId, message, documentName);
  }

  private buildNotificationLink(jobId: string): string {
    const params = new URLSearchParams({ docExtractionJobId: jobId });
    return `${DOCUMENT_EXTRACTION_LINK_BASE}?${params.toString()}`;
  }

  private async notifyBackgroundDone(
    userId: string,
    jobId: string,
    documentName?: string,
  ) {
    if (!this.notificationsService) return;
    const normalizedDocumentName = documentName?.trim();
    const message = normalizedDocumentName
      ? `A análise do documento "${normalizedDocumentName}" terminou. Clique para continuar a criação da solicitação.`
      : 'A análise do documento terminou. Clique para continuar a criação da solicitação.';

    await this.notificationsService.createNotification({
      userId,
      type: NotificationType.INFO,
      title: 'Análise de documento concluída',
      message,
      link: this.buildNotificationLink(jobId),
      metadata: {
        category: 'document_extraction',
        jobId,
        status: 'done',
        ...(normalizedDocumentName
          ? { documentName: normalizedDocumentName }
          : {}),
      },
    });
  }

  private async notifyBackgroundError(
    userId: string,
    jobId: string,
    message: string,
    documentName?: string,
  ) {
    if (!this.notificationsService) return;
    const normalizedDocumentName = documentName?.trim();
    const composedMessage = normalizedDocumentName
      ? `Não foi possível concluir a análise de "${normalizedDocumentName}". ${message || 'Clique para tentar novamente.'}`
      : message ||
        'Não foi possível concluir a análise. Clique para tentar novamente.';

    await this.notificationsService.createNotification({
      userId,
      type: NotificationType.INFO,
      title: 'Falha na análise do documento',
      message: composedMessage,
      link: this.buildNotificationLink(jobId),
      metadata: {
        category: 'document_extraction',
        jobId,
        status: 'error',
        ...(normalizedDocumentName
          ? { documentName: normalizedDocumentName }
          : {}),
      },
    });
  }

  private emitStatus(userId: string, payload: DocumentExtractionStatusEvent) {
    this.notificationsGateway?.emitDocumentExtractionStatus(userId, payload);
  }

  private getStatusTtlSeconds(): number {
    const raw = this.configService.get<number>(
      'AI_DOC_SC_EXTRACT_JOB_TTL_SECONDS',
      DEFAULT_STATUS_TTL_SECONDS,
    );
    if (!Number.isFinite(raw)) return DEFAULT_STATUS_TTL_SECONDS;
    return Math.min(Math.max(Math.floor(raw), 300), 7200);
  }

  private assertFileSize(file: Express.Multer.File): void {
    const maxBytes = this.configService.get<number>(
      'AI_DOC_MAX_BYTES',
      DEFAULT_MAX_BYTES,
    );
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `Arquivo muito grande. Máximo permitido: ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      );
    }
  }

  private assertJobOwnership(jobUserId: string, userId: string): void {
    if (!jobUserId || jobUserId !== userId) {
      throw new ForbiddenException('Você não tem acesso a este processamento.');
    }
  }

  private createRedisClient(): IORedis {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const username = this.configService.get<string>('REDIS_USERNAME');
    const tls = this.configService.get<string>('REDIS_TLS') === 'true';

    const client = new IORedis({
      host,
      port,
      ...(username && { username }),
      ...(password && { password }),
      ...(tls && { tls: {} }),
      enableOfflineQueue: true,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    client.connect().catch((err) => {
      this.logger.warn(
        `Redis indisponível para estado de extração de documentos: ${err.message}`,
      );
    });

    return client;
  }

  private requireRedisClient(): IORedis {
    if (!this.redis || this.redis.status !== 'ready') {
      throw new ServiceUnavailableException(
        'Serviço de processamento indisponível no momento. Tente novamente.',
      );
    }
    return this.redis;
  }

  private buildKey(jobId: string): string {
    return `${REDIS_KEY_PREFIX}${jobId}`;
  }

  private async setState(
    jobId: string,
    state: StoredDocumentExtractionState,
  ): Promise<void> {
    const redis = this.requireRedisClient();
    await redis.set(
      this.buildKey(jobId),
      JSON.stringify(state),
      'EX',
      this.getStatusTtlSeconds(),
    );
  }

  private async getState(
    jobId: string,
  ): Promise<StoredDocumentExtractionState | null> {
    const redis = this.requireRedisClient();
    const raw = await redis.get(this.buildKey(jobId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredDocumentExtractionState;
    } catch {
      return null;
    }
  }

  private async deleteState(jobId: string): Promise<void> {
    if (!this.redis || this.redis.status !== 'ready') return;
    await this.redis.del(this.buildKey(jobId));
  }
}
