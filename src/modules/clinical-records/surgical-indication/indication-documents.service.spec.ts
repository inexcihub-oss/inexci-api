import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import DOCUMENT_TYPES from 'src/common/document-types.common';
import { IndicationDocumentsService } from './indication-documents.service';

describe('IndicationDocumentsService', () => {
  let service: IndicationDocumentsService;

  const documentRepository = {
    findByPatientId: jest.fn(),
    findBySurgeryRequestId: jest.fn(),
    create: jest.fn(),
  };
  const storageService = { copy: jest.fn() };

  const patientDocument = (over: Record<string, unknown> = {}) => ({
    id: 'doc-1',
    patientId: 'patient-1',
    clinicalRecordId: 'record-1',
    type: DOCUMENT_TYPES.examReport,
    key: 'exam_report',
    name: 'RM joelho direito',
    uri: 'documents/owner-1/rm-joelho.pdf',
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    documentRepository.findByPatientId.mockResolvedValue([patientDocument()]);
    documentRepository.findBySurgeryRequestId.mockResolvedValue([]);
    documentRepository.create.mockImplementation((data: any) =>
      Promise.resolve({ id: 'novo', ...data }),
    );
    storageService.copy.mockResolvedValue('documents/owner-1/copia.pdf');

    const module = await Test.createTestingModule({
      providers: [
        IndicationDocumentsService,
        { provide: DocumentRepository, useValue: documentRepository },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    service = module.get(IndicationDocumentsService);
  });

  const copy = () =>
    service.copyPatientDocuments({
      patientId: 'patient-1',
      surgeryRequestId: 'sc-1',
      ownerId: 'owner-1',
      createdById: 'doctor-1',
    });

  it('copia o arquivo e vincula a cópia à solicitação', async () => {
    const copied = await copy();

    expect(storageService.copy).toHaveBeenCalledWith(
      'documents/owner-1/rm-joelho.pdf',
      'documents',
      'owner-1',
    );
    expect(documentRepository.create).toHaveBeenCalledWith({
      surgeryRequestId: 'sc-1',
      createdById: 'doctor-1',
      type: DOCUMENT_TYPES.examReport,
      key: 'exam_report',
      name: 'RM joelho direito',
      uri: 'documents/owner-1/copia.pdf',
    });
    expect(copied).toEqual({ copied: 1, failed: 0 });
  });

  it('não marca a cópia como documento do paciente, para não duplicar no prontuário', async () => {
    await copy();

    const created = documentRepository.create.mock.calls[0][0];
    expect(created.patientId).toBeUndefined();
    expect(created.clinicalRecordId).toBeUndefined();
  });

  it('duplica o arquivo em vez de reaproveitar o mesmo caminho', async () => {
    await copy();

    // Excluir um documento da SC apaga o arquivo do storage: se as duas linhas
    // apontassem para o mesmo objeto, o documento do prontuário sumiria junto.
    const created = documentRepository.create.mock.calls[0][0];
    expect(created.uri).not.toBe('documents/owner-1/rm-joelho.pdf');
  });

  it('ignora receita e atestado emitidos no atendimento', async () => {
    documentRepository.findByPatientId.mockResolvedValue([
      patientDocument({ id: 'd1', key: DOCUMENT_TYPES.prescription }),
      patientDocument({ id: 'd2', key: DOCUMENT_TYPES.medicalCertificate }),
      patientDocument({ id: 'd3', key: DOCUMENT_TYPES.examReferral }),
      patientDocument({ id: 'd4', key: 'exam_report' }),
    ]);

    const copied = await copy();

    expect(copied).toEqual({ copied: 2, failed: 0 });
    const keys = documentRepository.create.mock.calls.map(
      (c: any[]) => c[0].key,
    );
    expect(keys).toEqual([DOCUMENT_TYPES.examReferral, 'exam_report']);
  });

  // A fila reprocessa o job quando sobra trabalho; sem isso, cada tentativa
  // anexaria de novo o que já tinha sido copiado.
  it('pula o que a solicitação já recebeu numa tentativa anterior', async () => {
    documentRepository.findByPatientId.mockResolvedValue([
      patientDocument({ id: 'd1', name: 'RM joelho direito' }),
      patientDocument({ id: 'd2', name: 'Hemograma' }),
    ]);
    documentRepository.findBySurgeryRequestId.mockResolvedValue([
      { key: 'exam_report', name: 'RM joelho direito' },
    ]);

    const copied = await copy();

    expect(copied).toEqual({ copied: 1, failed: 0 });
    expect(documentRepository.create).toHaveBeenCalledTimes(1);
    expect(documentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hemograma' }),
    );
  });

  it('não faz nada quando o paciente não tem documentos', async () => {
    documentRepository.findByPatientId.mockResolvedValue([]);

    expect(await copy()).toEqual({ copied: 0, failed: 0 });
    expect(storageService.copy).not.toHaveBeenCalled();
  });

  it('ignora documentos sem arquivo', async () => {
    documentRepository.findByPatientId.mockResolvedValue([
      patientDocument({ uri: null }),
    ]);

    expect(await copy()).toEqual({ copied: 0, failed: 0 });
    expect(storageService.copy).not.toHaveBeenCalled();
  });

  it('segue copiando os demais quando um arquivo falha', async () => {
    documentRepository.findByPatientId.mockResolvedValue([
      patientDocument({ id: 'd1', name: 'quebrado' }),
      patientDocument({ id: 'd2', name: 'ok' }),
    ]);
    storageService.copy
      .mockRejectedValueOnce(new Error('R2 fora do ar'))
      .mockResolvedValueOnce('documents/owner-1/ok.pdf');

    const copied = await copy();

    // `failed` é o que sobrou para uma nova tentativa da fila.
    expect(copied).toEqual({ copied: 1, failed: 1 });
    expect(documentRepository.create).toHaveBeenCalledTimes(1);
    expect(documentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ok' }),
    );
  });

  it('não propaga erro quando a listagem falha — a SC já existe', async () => {
    documentRepository.findByPatientId.mockRejectedValue(new Error('db caiu'));

    // Nada copiado e trabalho pendente: a fila tenta de novo.
    await expect(copy()).resolves.toEqual({ copied: 0, failed: 1 });
  });
});
