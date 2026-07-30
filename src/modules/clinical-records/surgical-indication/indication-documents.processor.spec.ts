import { Logger } from '@nestjs/common';
import { IndicationDocumentsProcessor } from './indication-documents.processor';

describe('IndicationDocumentsProcessor', () => {
  let processor: IndicationDocumentsProcessor;

  const documentsService = { copyPatientDocuments: jest.fn() };

  const job = (attemptsMade = 0) =>
    ({
      id: 'job-1',
      attemptsMade,
      data: {
        patientId: 'patient-1',
        surgeryRequestId: 'sc-1',
        ownerId: 'owner-1',
        createdById: 'doctor-1',
      },
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    processor = new IndicationDocumentsProcessor(documentsService as never);
  });

  it('copia os documentos do job', async () => {
    documentsService.copyPatientDocuments.mockResolvedValue({
      copied: 3,
      failed: 0,
    });

    await processor.handleCopy(job());

    expect(documentsService.copyPatientDocuments).toHaveBeenCalledWith({
      patientId: 'patient-1',
      surgeryRequestId: 'sc-1',
      ownerId: 'owner-1',
      createdById: 'doctor-1',
    });
  });

  // O serviço nunca lança; sem isto, uma falha do R2 sumiria em silêncio e os
  // anexos nunca chegariam à solicitação.
  it('falha o job quando sobrou documento para copiar, para a fila tentar de novo', async () => {
    documentsService.copyPatientDocuments.mockResolvedValue({
      copied: 1,
      failed: 2,
    });

    await expect(processor.handleCopy(job())).rejects.toThrow(
      /2 de 3 documentos/,
    );
  });

  it('não falha o job quando não havia nada a copiar', async () => {
    documentsService.copyPatientDocuments.mockResolvedValue({
      copied: 0,
      failed: 0,
    });

    await expect(processor.handleCopy(job())).resolves.toBeUndefined();
  });
});
