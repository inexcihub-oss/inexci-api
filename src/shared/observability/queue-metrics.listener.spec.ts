const recordQueueJobDurationMock = jest.fn();

jest.mock('./metrics.util', () => ({
  recordQueueJobDuration: (...args: unknown[]) =>
    recordQueueJobDurationMock(...args),
}));

const reportPlatformErrorMock = jest.fn();

jest.mock('./platform-errors/platform-error-sink', () => ({
  reportPlatformError: (...args: unknown[]) => reportPlatformErrorMock(...args),
}));

import { QueueMetricsListener } from './queue-metrics.listener';

interface FakeQueueHandlers {
  completed?: (job: { processedOn?: number; finishedOn?: number }) => void;
  failed?: (job: Record<string, unknown>, error?: unknown) => void;
}

function createFakeQueue(name: string) {
  const handlers: FakeQueueHandlers = {};

  return {
    name,
    on: jest.fn((event: 'completed' | 'failed', handler: () => void) => {
      handlers[event] = handler;
    }),
    handlers,
  };
}

describe('QueueMetricsListener', () => {
  let mailQueue: ReturnType<typeof createFakeQueue>;
  let whatsappQueue: ReturnType<typeof createFakeQueue>;
  let pdfGenerationQueue: ReturnType<typeof createFakeQueue>;
  let aiMessagesQueue: ReturnType<typeof createFakeQueue>;
  let documentExtractionQueue: ReturnType<typeof createFakeQueue>;
  let indicationDocumentsQueue: ReturnType<typeof createFakeQueue>;
  let mentionEmailsQueue: ReturnType<typeof createFakeQueue>;
  let listener: QueueMetricsListener;

  beforeEach(() => {
    recordQueueJobDurationMock.mockClear();
    reportPlatformErrorMock.mockClear();

    mailQueue = createFakeQueue('mail');
    whatsappQueue = createFakeQueue('whatsapp-messages');
    pdfGenerationQueue = createFakeQueue('pdf-generation');
    aiMessagesQueue = createFakeQueue('ai-messages');
    documentExtractionQueue = createFakeQueue('document-extraction');
    indicationDocumentsQueue = createFakeQueue('indication-documents');
    mentionEmailsQueue = createFakeQueue('mention-emails');

    listener = new QueueMetricsListener(
      mailQueue as never,
      whatsappQueue as never,
      pdfGenerationQueue as never,
      aiMessagesQueue as never,
      documentExtractionQueue as never,
      indicationDocumentsQueue as never,
      mentionEmailsQueue as never,
    );

    listener.onModuleInit();
  });

  it('assina os eventos completed/failed das 7 filas', () => {
    [
      mailQueue,
      whatsappQueue,
      pdfGenerationQueue,
      aiMessagesQueue,
      indicationDocumentsQueue,
      documentExtractionQueue,
      mentionEmailsQueue,
    ].forEach((queue) => {
      expect(queue.on).toHaveBeenCalledWith('completed', expect.any(Function));
      expect(queue.on).toHaveBeenCalledWith('failed', expect.any(Function));
    });
  });

  it('registra a duração ao completar um job', () => {
    mailQueue.handlers.completed?.({ processedOn: 1000, finishedOn: 1250 });

    expect(recordQueueJobDurationMock).toHaveBeenCalledWith(250, {
      queue: 'mail',
      status: 'completed',
    });
  });

  it('registra a duração ao falhar um job', () => {
    whatsappQueue.handlers.failed?.({ processedOn: 2000, finishedOn: 2500 });

    expect(recordQueueJobDurationMock).toHaveBeenCalledWith(500, {
      queue: 'whatsapp-messages',
      status: 'failed',
    });
  });

  it('não quebra e não registra métrica quando processedOn está ausente', () => {
    pdfGenerationQueue.handlers.completed?.({ finishedOn: 3000 });

    expect(recordQueueJobDurationMock).not.toHaveBeenCalled();
  });

  it('não quebra e não registra métrica quando finishedOn está ausente', () => {
    aiMessagesQueue.handlers.failed?.({ processedOn: 3000 });

    expect(recordQueueJobDurationMock).not.toHaveBeenCalled();
  });

  it('não quebra e não registra métrica quando ambos estão ausentes', () => {
    documentExtractionQueue.handlers.completed?.({});

    expect(recordQueueJobDurationMock).not.toHaveBeenCalled();
  });

  it('falha final de um job vira erro da plataforma com a conta do job', () => {
    const erro = new Error('pdf quebrou');
    pdfGenerationQueue.handlers.failed?.(
      {
        attemptsMade: 3,
        opts: { attempts: 3 },
        data: { tenantId: 'owner-1', userId: 'user-1', requestId: 'req-1' },
      },
      erro,
    );
    expect(reportPlatformErrorMock).toHaveBeenCalledWith({
      source: 'queue',
      route: 'pdf-generation',
      error: erro,
      ownerId: 'owner-1',
      userId: 'user-1',
      requestId: 'req-1',
    });
  });

  it('tentativa intermediária não conta como erro', () => {
    documentExtractionQueue.handlers.failed?.(
      { attemptsMade: 1, opts: { attempts: 3 }, data: {} },
      new Error('x'),
    );
    expect(reportPlatformErrorMock).not.toHaveBeenCalled();
  });

  it('e-mail e WhatsApp não duplicam: a falha já fica no registro de envios', () => {
    mailQueue.handlers.failed?.(
      { attemptsMade: 3, opts: { attempts: 3 }, data: {} },
      new Error('smtp'),
    );
    whatsappQueue.handlers.failed?.(
      { attemptsMade: 3, opts: { attempts: 3 }, data: {} },
      new Error('twilio'),
    );
    expect(reportPlatformErrorMock).not.toHaveBeenCalled();
  });

  it('job sem dono e sem opts conta como falha final sem conta', () => {
    aiMessagesQueue.handlers.failed?.({ attemptsMade: 1, data: null }, 'x');
    expect(reportPlatformErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: null, userId: null, requestId: null }),
    );
  });
});
