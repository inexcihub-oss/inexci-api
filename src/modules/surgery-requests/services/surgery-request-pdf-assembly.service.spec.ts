import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { SurgeryRequestPdfAssemblyService } from './surgery-request-pdf-assembly.service';
import { PdfService } from 'src/shared/pdf/pdf.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import { DoctorHeaderRepository } from 'src/database/repositories/doctor-header.repository';

describe('SurgeryRequestPdfAssemblyService', () => {
  let service: SurgeryRequestPdfAssemblyService;

  const mockPdfService = {
    generateMedicalReportPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    generateSurgeryRequestLaudoPdf: jest
      .fn()
      .mockResolvedValue(Buffer.from('pdf')),
    generateContestAuthorizationPdf: jest
      .fn()
      .mockResolvedValue(Buffer.from('pdf')),
  };

  const assignedDoctor = {
    id: 'doctor-carlos-id',
    name: 'Dr. Carlos Mendonça',
    email: 'carlos@inexci.com',
    phone: '+5511999999999',
    doctorProfile: {
      id: 'profile-carlos',
      specialty: 'Ortopedia e Traumatologia',
      crm: '145632',
      crmState: 'SP',
      signatureUrl: 'signatures/carlos.png',
      header: {
        logoUrl: null,
        logoPosition: 'left',
        contentHtml:
          '<p>Clínica — Cabeçalho padrão para laudos (texto apenas, sem logo).</p>',
      },
    },
  };

  const baseRequest = {
    id: 'sc-1',
    doctorId: 'doctor-carlos-id',
    doctor: assignedDoctor,
    medicalReport: JSON.stringify({
      patientData: { name: 'Alessandro Filho', cpf: '14685854608' },
    }),
    patient: { name: 'Alessandro Filho', cpf: '14685854608' },
    healthPlan: { name: 'Hapvida' },
    hospital: {
      name: 'Hospital Sírio-Libanês',
      address: 'Rua Dona Adma Jafet',
    },
    reportSections: [{ title: 'Teste', description: 'Teste', order: 0 }],
    tussItems: [
      {
        name: 'Consulta em domicílio',
        tussCode: '00.10.10.102-0',
        quantity: 2,
      },
    ],
    opmeItems: [],
    documents: [],
    contestations: [
      {
        type: 'authorization',
        reason: 'Negativa indevida dos materiais solicitados.',
        createdAt: new Date('2026-06-22T00:00:00.000Z'),
      },
    ],
    activities: [],
  };

  const mockDataSource = {
    getRepository: jest.fn().mockReturnValue({
      find: jest.fn().mockResolvedValue([
        {
          name: 'Consulta em domicílio',
          tussCode: '00.10.10.102-0',
          quantity: 2,
          authorizedQuantity: 0,
        },
      ]),
    }),
  };

  const mockUserRepository = {
    findOneWithProfile: jest.fn(),
  };

  const mockStorageService = {
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/sig.png'),
  };

  const mockDoctorHeaderRepository = {
    findByDoctorProfileId: jest.fn().mockResolvedValue({
      logoUrl: null,
      logoPosition: 'left',
      contentHtml:
        '<p>Clínica — Cabeçalho padrão para laudos (texto apenas, sem logo).</p>',
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUserRepository.findOneWithProfile.mockResolvedValue(assignedDoctor);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurgeryRequestPdfAssemblyService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: PdfService, useValue: mockPdfService },
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: StorageService, useValue: mockStorageService },
        {
          provide: DoctorHeaderRepository,
          useValue: mockDoctorHeaderRepository,
        },
      ],
    }).compile();

    service = module.get(SurgeryRequestPdfAssemblyService);
  });

  describe('generateMedicalReportPdf', () => {
    it('deve usar o médico atribuído à solicitação, não o usuário logado', async () => {
      await service.generateMedicalReportPdf(baseRequest, 'gestor-user-id');

      expect(mockUserRepository.findOneWithProfile).not.toHaveBeenCalled();
      expect(
        mockDoctorHeaderRepository.findByDoctorProfileId,
      ).not.toHaveBeenCalled();

      expect(mockPdfService.generateMedicalReportPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorName: 'Dr. Carlos Mendonça',
          doctorSpecialty: 'Ortopedia e Traumatologia',
          doctorCrm: '145632',
          doctorCrmState: 'SP',
          doctorSignatureUrl: 'https://signed.example/sig.png',
          customHeader: expect.objectContaining({
            contentHtml:
              '<p>Clínica — Cabeçalho padrão para laudos (texto apenas, sem logo).</p>',
          }),
        }),
      );
    });
  });

  describe('generateLaudoPdf', () => {
    it('deve montar a solicitação cirúrgica com o médico atribuído à SC', async () => {
      await service.generateLaudoPdf(baseRequest, 'gestor-user-id', {
        includeInfoDocuments: false,
      });

      expect(mockUserRepository.findOneWithProfile).not.toHaveBeenCalled();
      expect(
        mockDoctorHeaderRepository.findByDoctorProfileId,
      ).not.toHaveBeenCalled();

      expect(mockPdfService.generateSurgeryRequestLaudoPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorName: 'Dr. Carlos Mendonça',
          doctorSpecialty: 'Ortopedia e Traumatologia',
          doctorCrm: 'CRM 145632/SP',
          doctorSignatureUrl: 'https://signed.example/sig.png',
          customHeader: expect.objectContaining({
            contentHtml:
              '<p>Clínica — Cabeçalho padrão para laudos (texto apenas, sem logo).</p>',
          }),
          localText: 'Hospital Sírio-Libanês – Rua Dona Adma Jafet',
        }),
      );
    });

    it('deve buscar o médico no banco quando a relação não veio pré-carregada', async () => {
      const requestWithoutDoctorRelation = {
        ...baseRequest,
        doctor: undefined,
      };

      await service.generateLaudoPdf(
        requestWithoutDoctorRelation,
        'gestor-user-id',
        { includeInfoDocuments: false },
      );

      expect(mockUserRepository.findOneWithProfile).toHaveBeenCalledWith({
        id: 'doctor-carlos-id',
      });
      expect(mockUserRepository.findOneWithProfile).not.toHaveBeenCalledWith({
        id: 'gestor-user-id',
      });
    });
  });

  describe('generateContestAuthorizationPdf', () => {
    it('deve montar a contestação com o médico atribuído à SC', async () => {
      await service.generateContestAuthorizationPdf(
        baseRequest,
        'sc-1',
        'gestor-user-id',
      );

      expect(mockUserRepository.findOneWithProfile).not.toHaveBeenCalled();
      expect(
        mockDoctorHeaderRepository.findByDoctorProfileId,
      ).not.toHaveBeenCalled();

      expect(
        mockPdfService.generateContestAuthorizationPdf,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'Negativa indevida dos materiais solicitados.',
          doctorName: 'Dr. Carlos Mendonça',
          doctorCrm: 'CRM 145632/SP',
          doctorSpecialty: 'Ortopedia e Traumatologia',
          doctorSignatureUrl: 'https://signed.example/sig.png',
          customHeader: expect.objectContaining({
            contentHtml:
              '<p>Clínica — Cabeçalho padrão para laudos (texto apenas, sem logo).</p>',
          }),
        }),
      );
    });
  });

  describe('loadAssignedDoctorData', () => {
    it('deve falhar quando a solicitação não tem médico atribuído', async () => {
      await expect(
        service.loadAssignedDoctorData({ id: 'sc-1' } as any),
      ).rejects.toThrow('Solicitação sem médico atribuído para geração de PDF');
    });
  });
});
