import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClinicalRecordRepository } from 'src/database/repositories/clinical-record.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { PdfService } from 'src/shared/pdf/pdf.service';
import { DoctorPdfContextService } from 'src/shared/pdf/doctor-pdf-context.service';
import DOCUMENT_TYPES from 'src/common/document-types.common';
import { ClinicalDocumentGenerationService } from './clinical-document-generation.service';

describe('ClinicalDocumentGenerationService', () => {
  let service: ClinicalDocumentGenerationService;

  const record = {
    id: 'record-1',
    ownerId: 'owner-1',
    doctorId: 'doctor-1',
    patientId: 'patient-1',
    cidCodes: [{ code: 'M23.3', description: 'Transtorno do menisco' }],
    finalizedAt: null,
  };

  const patient = {
    id: 'patient-1',
    ownerId: 'owner-1',
    name: 'Alessandro Filho',
    cpf: '14685854608',
    birthDate: '1985-03-10',
    phone: '21999998888',
    healthPlanId: 'plan-1',
    healthPlanNumber: '9988776655',
  };

  const clinicalRecordRepository = { findOne: jest.fn() };
  const patientRepository = { findOne: jest.fn() };
  const healthPlanRepository = { findOne: jest.fn() };
  const documentRepository = { create: jest.fn() };
  const accessControlService = { assertSameOwner: jest.fn() };
  const storageService = { create: jest.fn(), getSignedUrl: jest.fn() };
  const pdfService = {
    generatePrescriptionPdf: jest.fn(),
    generateMedicalCertificatePdf: jest.fn(),
    generateExamReferralPdf: jest.fn(),
    renderClinicalDocumentHtml: jest.fn(),
  };
  const doctorPdfContextService = { buildForDoctorId: jest.fn() };

  const prescriptionDto = {
    items: [
      {
        name: 'Dipirona 500mg',
        quantity: '1 caixa',
        instructions: 'Um comprimido a cada 6h',
      },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    clinicalRecordRepository.findOne.mockResolvedValue(record);
    patientRepository.findOne.mockResolvedValue(patient);
    healthPlanRepository.findOne.mockResolvedValue({
      id: 'plan-1',
      name: 'Hapvida',
    });
    accessControlService.assertSameOwner.mockResolvedValue(undefined);
    doctorPdfContextService.buildForDoctorId.mockResolvedValue({
      doctor: { name: 'Dra. Ana Souza' },
      profile: { specialty: 'Ortopedia' },
      doctorCrm: 'CRM 12345/RJ',
      doctorSignatureUrl: 'https://r2/assinatura.png',
      customHeader: null,
    });
    pdfService.generatePrescriptionPdf.mockResolvedValue(Buffer.from('pdf'));
    pdfService.generateMedicalCertificatePdf.mockResolvedValue(
      Buffer.from('pdf'),
    );
    pdfService.generateExamReferralPdf.mockResolvedValue(Buffer.from('pdf'));
    pdfService.renderClinicalDocumentHtml.mockResolvedValue(
      '<html>previa</html>',
    );
    storageService.create.mockResolvedValue('documents/receita.pdf');
    storageService.getSignedUrl.mockResolvedValue('https://r2/receita.pdf');
    documentRepository.create.mockImplementation((data: any) =>
      Promise.resolve({ id: 'doc-1', ...data }),
    );

    const module = await Test.createTestingModule({
      providers: [
        ClinicalDocumentGenerationService,
        {
          provide: ClinicalRecordRepository,
          useValue: clinicalRecordRepository,
        },
        { provide: PatientRepository, useValue: patientRepository },
        { provide: HealthPlanRepository, useValue: healthPlanRepository },
        { provide: DocumentRepository, useValue: documentRepository },
        { provide: AccessControlService, useValue: accessControlService },
        { provide: StorageService, useValue: storageService },
        { provide: PdfService, useValue: pdfService },
        {
          provide: DoctorPdfContextService,
          useValue: doctorPdfContextService,
        },
      ],
    }).compile();

    service = module.get(ClinicalDocumentGenerationService);
  });

  describe('receita', () => {
    it('usa o médico da ficha, não o usuário logado', async () => {
      await service.generatePrescription(
        'record-1',
        prescriptionDto as any,
        'secretaria-id',
      );

      expect(doctorPdfContextService.buildForDoctorId).toHaveBeenCalledWith(
        'doctor-1',
      );
      expect(pdfService.generatePrescriptionPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorName: 'Dra. Ana Souza',
          doctorCrm: 'CRM 12345/RJ',
          doctorSpecialty: 'Ortopedia',
          patientName: 'Alessandro Filho',
          items: prescriptionDto.items,
        }),
      );
    });

    it('formata CPF, telefone e data de nascimento do paciente', async () => {
      await service.generatePrescription(
        'record-1',
        prescriptionDto as any,
        'user-1',
      );

      expect(pdfService.generatePrescriptionPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          patientCpf: '146.858.546-08',
          patientBirthDate: '10/03/1985',
        }),
      );
    });

    it('salva o PDF como documento do paciente vinculado à ficha', async () => {
      const result = await service.generatePrescription(
        'record-1',
        prescriptionDto as any,
        'user-1',
      );

      expect(storageService.create).toHaveBeenCalledWith(
        expect.objectContaining({ mimetype: 'application/pdf' }),
        'documents',
        'owner-1',
      );
      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'patient-1',
          clinicalRecordId: 'record-1',
          createdById: 'user-1',
          type: DOCUMENT_TYPES.prescription,
          key: DOCUMENT_TYPES.prescription,
          uri: 'documents/receita.pdf',
        }),
      );
      expect(result.uri).toBe('https://r2/receita.pdf');
    });

    it('mantém o nome do documento dentro do limite da coluna (75)', async () => {
      patientRepository.findOne.mockResolvedValue({
        ...patient,
        name: 'Maria Aparecida'.repeat(10),
      });

      await service.generatePrescription(
        'record-1',
        prescriptionDto as any,
        'user-1',
      );

      const created = documentRepository.create.mock.calls[0][0];
      expect(created.name.length).toBeLessThanOrEqual(75);
    });

    it('recusa a ficha de outro tenant', async () => {
      accessControlService.assertSameOwner.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.generatePrescription(
          'record-1',
          prescriptionDto as any,
          'intruso',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(pdfService.generatePrescriptionPdf).not.toHaveBeenCalled();
    });

    it('falha quando a ficha não existe', async () => {
      clinicalRecordRepository.findOne.mockResolvedValue(null);

      await expect(
        service.generatePrescription(
          'sumida',
          prescriptionDto as any,
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('atestado', () => {
    it('pluraliza o afastamento em dias', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        { restDays: 3, startDate: '2026-07-30' } as any,
        'user-1',
      );

      expect(pdfService.generateMedicalCertificatePdf).toHaveBeenCalledWith(
        expect.objectContaining({
          restDaysLabel: '3 dias',
          startDate: '30/07/2026',
        }),
      );
    });

    it('usa o singular para um único dia', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        { restDays: 1 } as any,
        'user-1',
      );

      expect(pdfService.generateMedicalCertificatePdf).toHaveBeenCalledWith(
        expect.objectContaining({ restDaysLabel: '1 dia' }),
      );
    });

    it('usa o CID escolhido no atestado, mesmo diferente do da ficha', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        {
          restDays: 2,
          includeCid: true,
          cid: { code: 'M54.5', description: 'Dor lombar baixa' },
        } as any,
        'user-1',
      );

      expect(pdfService.generateMedicalCertificatePdf).toHaveBeenCalledWith(
        expect.objectContaining({
          cid: { code: 'M54.5', description: 'Dor lombar baixa' },
        }),
      );
    });

    it('imprime o CID escolhido mesmo sem marcar a inclusão do CID da ficha', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        {
          restDays: 2,
          cid: { code: 'J06.9', description: 'Infecção aguda' },
        } as any,
        'user-1',
      );

      expect(pdfService.generateMedicalCertificatePdf).toHaveBeenCalledWith(
        expect.objectContaining({
          cid: { code: 'J06.9', description: 'Infecção aguda' },
        }),
      );
    });

    it('só imprime o CID quando o paciente autoriza', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        { restDays: 2 } as any,
        'user-1',
      );

      expect(pdfService.generateMedicalCertificatePdf).toHaveBeenCalledWith(
        expect.objectContaining({ cid: null }),
      );

      await service.generateMedicalCertificate(
        'record-1',
        { restDays: 2, includeCid: true } as any,
        'user-1',
      );

      expect(pdfService.generateMedicalCertificatePdf).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cid: { code: 'M23.3', description: 'Transtorno do menisco' },
        }),
      );
    });

    it('salva com o tipo de atestado', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        { restDays: 1 } as any,
        'user-1',
      );

      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: DOCUMENT_TYPES.medicalCertificate }),
      );
    });
  });

  describe('pré-visualização', () => {
    it('devolve o HTML do documento sem gravar nada', async () => {
      const html = await service.previewPrescription(
        'record-1',
        prescriptionDto as any,
        'user-1',
      );

      expect(html).toBe('<html>previa</html>');
      // Conferir não pode registrar nada no prontuário.
      expect(storageService.create).not.toHaveBeenCalled();
      expect(documentRepository.create).not.toHaveBeenCalled();
    });

    // Gerar PDF sobe um Chromium; para conferir na tela isso custa segundos e
    // não acrescenta nada — o HTML é o mesmo que vira PDF na emissão.
    it('não invoca o Puppeteer para pré-visualizar', async () => {
      await service.previewPrescription(
        'record-1',
        prescriptionDto as any,
        'user-1',
      );

      expect(pdfService.generatePrescriptionPdf).not.toHaveBeenCalled();
    });

    it('pré-visualiza a partir do mesmo template e dos mesmos dados da emissão', async () => {
      await service.previewPrescription(
        'record-1',
        prescriptionDto as any,
        'user-1',
      );
      const [template, previewData] =
        pdfService.renderClinicalDocumentHtml.mock.calls[0];

      await service.generatePrescription(
        'record-1',
        prescriptionDto as any,
        'user-1',
      );

      expect(template).toBe('prescription');
      expect(pdfService.generatePrescriptionPdf).toHaveBeenCalledWith(
        previewData,
      );
    });

    it('pré-visualiza atestado e encaminhamento pelos templates certos', async () => {
      await service.previewMedicalCertificate(
        'record-1',
        { restDays: 1 } as any,
        'user-1',
      );
      expect(pdfService.renderClinicalDocumentHtml).toHaveBeenLastCalledWith(
        'medical-certificate',
        expect.anything(),
      );

      await service.previewExamReferral(
        'record-1',
        { exams: [{ name: 'Hemograma' }] } as any,
        'user-1',
      );
      expect(pdfService.renderClinicalDocumentHtml).toHaveBeenLastCalledWith(
        'exam-referral',
        expect.anything(),
      );
      expect(documentRepository.create).not.toHaveBeenCalled();
    });

    it('recusa pré-visualizar ficha de outro tenant', async () => {
      accessControlService.assertSameOwner.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.previewPrescription('record-1', prescriptionDto as any, 'x'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('encaminhamento de exames', () => {
    const referralDto = {
      exams: [
        { name: 'Ressonância de joelho', tussCode: '4.09.01.14-0' },
        { name: 'Hemograma completo' },
      ],
      clinicalIndication: 'Dor há 3 meses',
    };

    it('herda os CIDs da ficha e leva o convênio do paciente', async () => {
      await service.generateExamReferral(
        'record-1',
        referralDto as any,
        'user-1',
      );

      expect(pdfService.generateExamReferralPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          exams: referralDto.exams,
          clinicalIndication: 'Dor há 3 meses',
          cidCodes: record.cidCodes,
          patientHealthPlan: 'Hapvida',
          patientHealthPlanNumber: '9988776655',
        }),
      );
    });

    it('não busca convênio quando o paciente não tem um vinculado', async () => {
      patientRepository.findOne.mockResolvedValue({
        ...patient,
        healthPlanId: null,
      });

      await service.generateExamReferral(
        'record-1',
        referralDto as any,
        'user-1',
      );

      expect(healthPlanRepository.findOne).not.toHaveBeenCalled();
      expect(pdfService.generateExamReferralPdf).toHaveBeenCalledWith(
        expect.objectContaining({ patientHealthPlan: undefined }),
      );
    });

    it('salva com o tipo de encaminhamento', async () => {
      await service.generateExamReferral(
        'record-1',
        referralDto as any,
        'user-1',
      );

      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: DOCUMENT_TYPES.examReferral }),
      );
    });
  });
});
