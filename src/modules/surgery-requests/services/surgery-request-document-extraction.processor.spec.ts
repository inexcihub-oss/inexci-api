import { Job } from 'bull';
import { SurgeryRequestDocumentExtractionProcessor } from './surgery-request-document-extraction.processor';
import { getRequestContext } from 'src/shared/logging/request-context';

describe('SurgeryRequestDocumentExtractionProcessor', () => {
  let fromDocumentService: { extractFromDocument: jest.Mock };
  let jobsService: {
    markProcessing: jest.Mock;
    markDone: jest.Mock;
    markError: jest.Mock;
  };
  let processor: SurgeryRequestDocumentExtractionProcessor;

  beforeEach(() => {
    fromDocumentService = {
      extractFromDocument: jest
        .fn()
        .mockResolvedValue({ kind: 'medical_report' }),
    };
    jobsService = {
      markProcessing: jest.fn().mockResolvedValue(undefined),
      markDone: jest.fn().mockResolvedValue(undefined),
      markError: jest.fn().mockResolvedValue(undefined),
    };
    processor = new SurgeryRequestDocumentExtractionProcessor(
      fromDocumentService as any,
      jobsService as any,
    );
  });

  it('marca processing e done em execução bem-sucedida', async () => {
    const job = {
      id: 'job-1',
      data: {
        userId: 'user-1',
        file: {
          originalname: 'doc.pdf',
          mimetype: 'application/pdf',
          size: 100,
          bufferBase64: Buffer.from('abc').toString('base64'),
        },
      },
      attemptsMade: 0,
    } as Job<any>;

    await processor.handleExtractFromDocument(job);

    expect(jobsService.markProcessing).toHaveBeenCalledWith('job-1', 'user-1');
    expect(fromDocumentService.extractFromDocument).toHaveBeenCalled();
    expect(jobsService.markDone).toHaveBeenCalledWith(
      'job-1',
      'user-1',
      expect.objectContaining({ kind: 'medical_report' }),
      'doc.pdf',
    );
  });

  it('propaga userId do job para o contexto de log (AsyncLocalStorage)', async () => {
    let capturedUserId: string | null | undefined;
    fromDocumentService.extractFromDocument.mockImplementation(() => {
      capturedUserId = getRequestContext()?.userId;
      return Promise.resolve({ kind: 'medical_report' });
    });

    const job = {
      id: 'job-3',
      data: {
        userId: 'user-99',
        file: {
          originalname: 'doc.pdf',
          mimetype: 'application/pdf',
          size: 100,
          bufferBase64: Buffer.from('abc').toString('base64'),
        },
      },
      attemptsMade: 0,
    } as Job<any>;

    await processor.handleExtractFromDocument(job);

    expect(capturedUserId).toBe('user-99');
    expect(getRequestContext()).toBeUndefined();
  });

  it('registra erro amigável no dead-letter quando esgota tentativas', async () => {
    const job = {
      id: 'job-2',
      attemptsMade: 3,
      opts: { attempts: 3 },
      data: { userId: 'user-2' },
    } as Job<any>;

    await processor.handleFailed(job, new Error('timeout'));

    expect(jobsService.markError).toHaveBeenCalledWith(
      'job-2',
      'user-2',
      'Não foi possível processar o documento. Tente novamente.',
      undefined,
    );
  });
});
