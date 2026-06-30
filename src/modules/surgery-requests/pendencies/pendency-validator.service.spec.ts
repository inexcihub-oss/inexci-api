import { BadRequestException } from '@nestjs/common';
import { PendencyValidatorService } from './pendency-validator.service';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';

describe('PendencyValidatorService — patient_data', () => {
  const mockRepository = {
    findOne: jest.fn(),
  };

  const service = new PendencyValidatorService(mockRepository as any);

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
  const service = new PendencyValidatorService(mockRepository as any);

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
