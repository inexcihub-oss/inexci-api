const recordQueueJobDurationMock = jest.fn();

jest.mock('./metrics.util', () => ({
  recordQueueJobDuration: (...args: unknown[]) =>
    recordQueueJobDurationMock(...args),
}));

import { QueueMetricsListener } from './queue-metrics.listener';

interface FakeQueueHandlers {
  completed?: (job: { processedOn?: number; finishedOn?: number }) => void;
  failed?: (job: { processedOn?: number; finishedOn?: number }) => void;
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
  let listener: QueueMetricsListener;

  beforeEach(() => {
    recordQueueJobDurationMock.mockClear();

    mailQueue = createFakeQueue('mail');
    whatsappQueue = createFakeQueue('whatsapp-messages');
    pdfGenerationQueue = createFakeQueue('pdf-generation');
    aiMessagesQueue = createFakeQueue('ai-messages');
    documentExtractionQueue = createFakeQueue('document-extraction');

    listener = new QueueMetricsListener(
      mailQueue as never,
      whatsappQueue as never,
      pdfGenerationQueue as never,
      aiMessagesQueue as never,
      documentExtractionQueue as never,
    );

    listener.onModuleInit();
  });

  it('assina os eventos completed/failed das 5 filas', () => {
    [
      mailQueue,
      whatsappQueue,
      pdfGenerationQueue,
      aiMessagesQueue,
      documentExtractionQueue,
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
});
