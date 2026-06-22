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
