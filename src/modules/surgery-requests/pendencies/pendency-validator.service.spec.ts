import { BadRequestException } from '@nestjs/common';
import { PendencyValidatorService } from './pendency-validator.service';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';

/** Repositórios de coleções to-many não são usados pelos testes que só passam por `loadRequest` (singular). */
const buildCollectionRepoMocks = () => ({
  opmeItemRepository: { findMany: jest.fn() } as any,
  documentRepository: { findMany: jest.fn() } as any,
  tussItemRepository: { findMany: jest.fn() } as any,
  reportSectionRepository: { find: jest.fn() } as any,
});

describe('PendencyValidatorService — patient_data', () => {
  const mockRepository = {
    findOne: jest.fn(),
  };

  const {
    opmeItemRepository,
    documentRepository,
    tussItemRepository,
    reportSectionRepository,
  } = buildCollectionRepoMocks();
  const service = new PendencyValidatorService(
    mockRepository as any,
    opmeItemRepository,
    documentRepository,
    tussItemRepository,
    reportSectionRepository,
  );

  const baseRequest = {
    id: 'req-1',
    status: SurgeryRequestStatus.PENDING,
    patient: { name: 'João Silva', cpf: '12345678901' },
    hospitalId: 'hospital-1',
    tussItems: [{ id: 'tuss-1' }],
    hasOpme: false,
    reportSections: [{ id: 'section-1' }],
    doctor: { doctorProfile: { signatureUrl: 'https://sig.url' } },
    documents: [],
    opmeItems: [],
  } as unknown as SurgeryRequest;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('considera patient_data completo com apenas nome e CPF', async () => {
    mockRepository.findOne.mockResolvedValue(baseRequest);

    const result = await service.validateForStatus('req-1');

    const patientData = result.pendencies.find((p) => p.key === 'patient_data');
    expect(patientData?.isComplete).toBe(true);
    expect(patientData?.checkItems).toEqual([
      { label: 'Nome do paciente', done: true },
      { label: 'CPF', done: true },
    ]);
  });

  it('considera patient_data incompleto sem CPF', async () => {
    mockRepository.findOne.mockResolvedValue({
      ...baseRequest,
      patient: { name: 'João Silva' },
    });

    const result = await service.validateForStatus('req-1');

    const patientData = result.pendencies.find((p) => p.key === 'patient_data');
    expect(patientData?.isComplete).toBe(false);
    expect(patientData?.checkItems).toEqual([
      { label: 'Nome do paciente', done: true },
      { label: 'CPF', done: false },
    ]);
  });

  it('considera medical_report completo com nome, CPF, seção e assinatura', async () => {
    mockRepository.findOne.mockResolvedValue(baseRequest);

    const result = await service.validateForStatus('req-1');

    const medicalReport = result.pendencies.find(
      (p) => p.key === 'medical_report',
    );
    expect(medicalReport?.isComplete).toBe(true);
    expect(medicalReport?.checkItems).toEqual([
      { label: 'Nome do paciente', done: true },
      { label: 'CPF', done: true },
      { label: 'Ao menos 1 seção de laudo preenchida', done: true },
      { label: 'Assinatura do médico configurada', done: true },
    ]);
  });

  it('considera medical_report incompleto sem CPF mesmo com demais dados opcionais', async () => {
    mockRepository.findOne.mockResolvedValue({
      ...baseRequest,
      patient: {
        name: 'João Silva',
        birthDate: '1990-01-01',
        phone: '21999999999',
        address: 'Rua A',
        zipCode: '20000000',
      },
    });

    const result = await service.validateForStatus('req-1');

    const medicalReport = result.pendencies.find(
      (p) => p.key === 'medical_report',
    );
    expect(medicalReport?.isComplete).toBe(false);
  });
});

describe('PendencyValidatorService — assertCanAdvance', () => {
  const mockRepository = { findOne: jest.fn() };
  const {
    opmeItemRepository,
    documentRepository,
    tussItemRepository,
    reportSectionRepository,
  } = buildCollectionRepoMocks();
  const service = new PendencyValidatorService(
    mockRepository as any,
    opmeItemRepository,
    documentRepository,
    tussItemRepository,
    reportSectionRepository,
  );

  const completeRequest = {
    id: 'req-ok',
    status: SurgeryRequestStatus.PENDING,
    patient: { name: 'Ana Lima', cpf: '98765432100' },
    hospitalId: 'h-1',
    tussItems: [{ id: 't-1' }],
    hasOpme: false,
    reportSections: [{ id: 's-1' }],
    doctor: { doctorProfile: { signatureUrl: 'https://sig.url' } },
    documents: [],
    opmeItems: [],
  } as unknown as SurgeryRequest;

  const incompleteRequest = {
    id: 'req-bad',
    status: SurgeryRequestStatus.PENDING,
    patient: { name: 'Fulano' },
    hospitalId: null,
    tussItems: [],
    hasOpme: null,
    reportSections: [],
    doctor: { doctorProfile: { signatureUrl: null } },
    documents: [],
    opmeItems: [],
  } as unknown as SurgeryRequest;

  beforeEach(() => jest.clearAllMocks());

  it('não lança quando todas as pendências bloqueantes estão resolvidas', async () => {
    mockRepository.findOne.mockResolvedValue(completeRequest);
    await expect(service.assertCanAdvance('req-ok')).resolves.toBeUndefined();
  });

  it('lança BadRequestException com pendencies[] quando há bloqueantes não resolvidas', async () => {
    mockRepository.findOne.mockResolvedValue(incompleteRequest);
    await expect(service.assertCanAdvance('req-bad')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('payload de erro contém message e pendencies[] com keys corretas', async () => {
    mockRepository.findOne.mockResolvedValue(incompleteRequest);
    try {
      await service.assertCanAdvance('req-bad');
      fail('deveria ter lançado');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = err.getResponse();
      expect(body.message).toBe(
        'Existem pendências que impedem o avanço de status.',
      );
      expect(Array.isArray(body.pendencies)).toBe(true);
      const keys = body.pendencies.map((p: any) => p.key);
      expect(keys).toContain('patient_data');
      expect(keys).toContain('hospital_data');
      expect(keys).toContain('tuss_procedures');
      expect(keys).toContain('opme_items');
      expect(keys).toContain('medical_report');
    }
  });

  it('não lança quando SC está em status sem pendências bloqueantes (SENT)', async () => {
    mockRepository.findOne.mockResolvedValue({
      ...completeRequest,
      status: SurgeryRequestStatus.SENT,
    });
    await expect(service.assertCanAdvance('req-sent')).resolves.toBeUndefined();
  });
});

describe('PendencyValidatorService — consent_term (IN_SCHEDULING)', () => {
  const mockRepository = { findOne: jest.fn() };
  const {
    opmeItemRepository,
    documentRepository,
    tussItemRepository,
    reportSectionRepository,
  } = buildCollectionRepoMocks();
  const service = new PendencyValidatorService(
    mockRepository as any,
    opmeItemRepository,
    documentRepository,
    tussItemRepository,
    reportSectionRepository,
  );

  const schedulingRequest = {
    id: 'req-sched',
    status: SurgeryRequestStatus.IN_SCHEDULING,
    dateOptions: ['2026-08-01'],
    selectedDateIndex: 0,
    documents: [],
    opmeItems: [],
    tussItems: [],
  } as unknown as SurgeryRequest;

  beforeEach(() => jest.clearAllMocks());

  it('consent_term é opcional e não bloqueia o avanço quando ausente', async () => {
    mockRepository.findOne.mockResolvedValue(schedulingRequest);

    const result = await service.validateForStatus('req-sched');
    const consent = result.pendencies.find((p) => p.key === 'consent_term');

    expect(consent?.isOptional).toBe(true);
    expect(consent?.isComplete).toBe(false);
    expect(result.canAdvance).toBe(true);
    await expect(
      service.assertCanAdvance('req-sched'),
    ).resolves.toBeUndefined();
  });

  it('consent_term é resolvida quando o termo já foi anexado', async () => {
    mockRepository.findOne.mockResolvedValue({
      ...schedulingRequest,
      documents: [{ key: 'consent_term', name: 'Termo' }],
    });

    const result = await service.validateForStatus('req-sched');
    const consent = result.pendencies.find((p) => p.key === 'consent_term');

    expect(consent?.isComplete).toBe(true);
  });
});

describe('PendencyValidatorService — getBatchSummary', () => {
  const mockRepository = { findOne: jest.fn(), find: jest.fn() };
  const opmeItemRepository = { findMany: jest.fn() };
  const documentRepository = { findMany: jest.fn() };
  const tussItemRepository = { findMany: jest.fn() };
  const reportSectionRepository = { find: jest.fn() };
  const service = new PendencyValidatorService(
    mockRepository as any,
    opmeItemRepository as any,
    documentRepository as any,
    tussItemRepository as any,
    reportSectionRepository as any,
  );

  // Bases sem as coleções to-many embutidas: agora elas chegam via `Promise.all`
  // separado (join to-one + 4 buscas paralelas por `surgeryRequestId`), não mais
  // dentro do mesmo `find` da SC.
  const completeRequestBase = {
    id: 'req-ok',
    status: SurgeryRequestStatus.PENDING,
    patient: { name: 'Ana Lima', cpf: '98765432100' },
    hospitalId: 'h-1',
    hasOpme: false,
    doctor: { doctorProfile: { signatureUrl: 'https://sig.url' } },
  } as unknown as SurgeryRequest;

  const incompleteRequestBase = {
    id: 'req-bad',
    status: SurgeryRequestStatus.PENDING,
    patient: { name: 'Fulano' },
    hospitalId: null,
    hasOpme: null,
    doctor: { doctorProfile: { signatureUrl: null } },
  } as unknown as SurgeryRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    opmeItemRepository.findMany.mockResolvedValue([]);
    documentRepository.findMany.mockResolvedValue([]);
    tussItemRepository.findMany.mockResolvedValue([]);
    reportSectionRepository.find.mockResolvedValue([]);
  });

  it('carrega o lote em paralelo (join to-one + 4 coleções, sem N+1 sequencial) e resume cada SC', async () => {
    mockRepository.find.mockResolvedValue([
      completeRequestBase,
      incompleteRequestBase,
    ]);
    tussItemRepository.findMany.mockResolvedValue([
      { id: 't-1', surgeryRequestId: 'req-ok' },
    ]);
    reportSectionRepository.find.mockResolvedValue([
      { id: 's-1', surgeryRequestId: 'req-ok' },
    ]);

    const result = await service.getBatchSummary('req-ok, req-bad', 'owner-1');

    // 1 query base (to-one) + 4 buscas de coleções, todas em paralelo — não sequenciais.
    expect(mockRepository.find).toHaveBeenCalledTimes(1);
    expect(tussItemRepository.findMany).toHaveBeenCalledTimes(1);
    expect(opmeItemRepository.findMany).toHaveBeenCalledTimes(1);
    expect(documentRepository.findMany).toHaveBeenCalledTimes(1);
    expect(reportSectionRepository.find).toHaveBeenCalledTimes(1);
    expect(mockRepository.findOne).not.toHaveBeenCalled();

    expect(result['req-ok'].canAdvance).toBe(true);
    expect(result['req-bad'].canAdvance).toBe(false);
    expect(result['req-bad'].pending).toBeGreaterThan(0);
  });

  it('devolve default seguro para ids não encontrados', async () => {
    mockRepository.find.mockResolvedValue([completeRequestBase]);
    tussItemRepository.findMany.mockResolvedValue([
      { id: 't-1', surgeryRequestId: 'req-ok' },
    ]);
    reportSectionRepository.find.mockResolvedValue([
      { id: 's-1', surgeryRequestId: 'req-ok' },
    ]);

    const result = await service.getBatchSummary(
      'req-ok,missing-id',
      'owner-1',
    );

    expect(result['req-ok'].canAdvance).toBe(true);
    expect(result['missing-id']).toEqual({
      pending: 0,
      total: 0,
      canAdvance: true,
    });
  });

  it('mantém defaults quando a carga em lote falha', async () => {
    mockRepository.find.mockRejectedValue(new Error('db down'));

    const result = await service.getBatchSummary('a,b', 'owner-1');

    expect(result).toEqual({
      a: { pending: 0, total: 0, canAdvance: true },
      b: { pending: 0, total: 0, canAdvance: true },
    });
  });

  it('devolve objeto vazio para lista de ids vazia', async () => {
    const result = await service.getBatchSummary('  ,  ', 'owner-1');
    expect(result).toEqual({});
    expect(mockRepository.find).not.toHaveBeenCalled();
  });
});
