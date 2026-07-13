import { SurgeryRequestsController } from './surgery-requests.controller';

describe('SurgeryRequestsController', () => {
  let surgeryRequestsService: any;
  let fromDocumentService: any;
  let documentExtractionJobsService: any;
  let controller: SurgeryRequestsController;

  beforeEach(() => {
    surgeryRequestsService = {
      createSurgeryRequest: jest.fn(),
    };
    fromDocumentService = {
      createFromDocument: jest.fn(),
    };
    documentExtractionJobsService = {
      enqueue: jest
        .fn()
        .mockResolvedValue({ jobId: 'job-1', status: 'processing' }),
      getStatus: jest.fn().mockResolvedValue({ status: 'processing' }),
    };

    controller = new SurgeryRequestsController(
      surgeryRequestsService,
      fromDocumentService,
      documentExtractionJobsService,
    );
  });

  it('enfileira extração e retorna jobId/status', async () => {
    const file = {
      originalname: 'doc.pdf',
      mimetype: 'application/pdf',
      size: 100,
      buffer: Buffer.from('abc'),
    } as Express.Multer.File;

    const result = await controller.extractFromDocument(file, {
      userId: 'user-1',
    } as any);

    expect(documentExtractionJobsService.enqueue).toHaveBeenCalledWith(
      file,
      'user-1',
    );
    expect(result).toEqual({ jobId: 'job-1', status: 'processing' });
  });

  it('consulta status do job com escopo do usuário autenticado', async () => {
    const result = await controller.getExtractFromDocumentStatus('job-1', {
      userId: 'user-1',
    } as any);

    expect(documentExtractionJobsService.getStatus).toHaveBeenCalledWith(
      'job-1',
      'user-1',
    );
    expect(result).toEqual({ status: 'processing' });
  });
});
