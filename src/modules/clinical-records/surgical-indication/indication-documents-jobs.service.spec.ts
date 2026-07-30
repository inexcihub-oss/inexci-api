import { Logger } from '@nestjs/common';
import { IndicationDocumentsJobsService } from './indication-documents-jobs.service';

describe('IndicationDocumentsJobsService', () => {
  let service: IndicationDocumentsJobsService;

  const queue = { add: jest.fn() };
  const documentsService = { copyPatientDocuments: jest.fn() };

  const params = {
    patientId: 'patient-1',
    surgeryRequestId: 'sc-1',
    ownerId: 'owner-1',
    createdById: 'doctor-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    queue.add.mockResolvedValue({ id: 'job-1' });
    documentsService.copyPatientDocuments.mockResolvedValue({
      copied: 1,
      failed: 0,
    });

    service = new IndicationDocumentsJobsService(
      queue as never,
      documentsService as never,
    );
  });

  it('enfileira a cópia em vez de segurar a resposta do atendimento', async () => {
    await service.schedule(params);

    expect(queue.add).toHaveBeenCalledWith(
      'copy-patient-documents',
      expect.objectContaining(params),
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
    expect(documentsService.copyPatientDocuments).not.toHaveBeenCalled();
  });

  it('copia na hora quando não consegue enfileirar', async () => {
    queue.add.mockRejectedValue(new Error('Redis offline'));

    await service.schedule(params);

    // Sem Redis a cópia ainda acontece — melhor um atendimento mais lento do
    // que uma solicitação sem os exames.
    expect(documentsService.copyPatientDocuments).toHaveBeenCalledWith(params);
  });

  it('não propaga erro quando nem a fila nem a cópia direta funcionam', async () => {
    queue.add.mockRejectedValue(new Error('Redis offline'));
    documentsService.copyPatientDocuments.mockRejectedValue(
      new Error('R2 fora do ar'),
    );

    await expect(service.schedule(params)).resolves.toBeUndefined();
  });
});
