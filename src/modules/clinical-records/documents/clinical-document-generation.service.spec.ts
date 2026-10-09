import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
import { ClinicalDocumentTemplatesService } from '../document-templates/clinical-document-templates.service';
import { ClinicalDocumentTemplateKind } from 'src/database/entities/clinical-document-template.entity';

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
  const accessControlService = {
    assertSameOwner: jest.fn(),
    assertCanAccessDoctorResource: jest.fn(),
    assertCanIssueClinicalDocuments: jest.fn(),
  };
  const storageService = { create: jest.fn(), getSignedUrl: jest.fn() };
  const pdfService = {
    generatePrescriptionPdf: jest.fn(),
    generateMedicalCertificatePdf: jest.fn(),
    generateExamReferralPdf: jest.fn(),
    renderClinicalDocumentHtml: jest.fn(),
  };
  const doctorPdfContextService = { buildForDoctorId: jest.fn() };
  const documentTemplatesService = {
    getForUse: jest.fn(),
    incrementUsage: jest.fn(),
  };

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
    accessControlService.assertCanAccessDoctorResource.mockResolvedValue(
      undefined,
    );
    accessControlService.assertCanIssueClinicalDocuments.mockResolvedValue(
      undefined,
    );
    doctorPdfContextService.buildForDoctorId.mockResolvedValue({
      doctor: { name: 'Dra. Ana Souza' },
      profile: {
        council: 'CRM',
        specialty: 'Ortopedia',
        crm: '12345',
        crmState: 'RJ',
      },
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
        {
          provide: ClinicalDocumentTemplatesService,
          useValue: documentTemplatesService,
        },
      ],
    }).compile();

    service = module.get(ClinicalDocumentGenerationService);
  });

  describe('receita', () => {
    it('assina com o médico da ficha, que é quem emite', async () => {
      await service.generatePrescription(
        'record-1',
        prescriptionDto as any,
        'doctor-1',
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
        'doctor-1',
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
        'doctor-1',
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
          createdById: 'doctor-1',
          type: DOCUMENT_TYPES.prescription,
          key: DOCUMENT_TYPES.prescription,
          uri: 'documents/receita.pdf',
        }),
      );
      expect(result.uri).toBe('https://r2/receita.pdf');
    });

    it('data o documento pelo dia de São Paulo, não pelo de UTC', async () => {
      jest.useFakeTimers({
        now: new Date('2026-10-08T01:30:00Z'),
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      try {
        await service.generatePrescription(
          'record-1',
          prescriptionDto as any,
          'doctor-1',
        );
      } finally {
        jest.useRealTimers();
      }

      expect(pdfService.generatePrescriptionPdf).toHaveBeenCalledWith(
        expect.objectContaining({ today: '07/10/2026' }),
      );
      expect(documentRepository.create.mock.calls[0][0].name).toContain(
        '07/10/2026',
      );
    });

    it('mantém o nome do documento dentro do limite da coluna (75)', async () => {
      patientRepository.findOne.mockResolvedValue({
        ...patient,
        name: 'Maria Aparecida'.repeat(10),
      });

      await service.generatePrescription(
        'record-1',
        prescriptionDto as any,
        'doctor-1',
      );

      const created = documentRepository.create.mock.calls[0][0];
      expect(created.name.length).toBeLessThanOrEqual(75);
    });

    it('recusa a ficha de outro tenant', async () => {
      accessControlService.assertCanAccessDoctorResource.mockRejectedValue(
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

    it('exige acesso ao médico da ficha, não só à clínica', async () => {
      accessControlService.assertCanAccessDoctorResource.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.generatePrescription(
          'record-1',
          prescriptionDto as any,
          'colaborador',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(
        accessControlService.assertCanAccessDoctorResource,
      ).toHaveBeenCalledWith('colaborador', 'owner-1', 'doctor-1');
      expect(doctorPdfContextService.buildForDoctorId).not.toHaveBeenCalled();
      expect(documentRepository.create).not.toHaveBeenCalled();
    });

    it.each([
      [
        'atestado',
        () =>
          service.generateMedicalCertificate(
            'record-1',
            { restDays: 3 } as any,
            'colaborador',
          ),
      ],
      [
        'encaminhamento',
        () =>
          service.generateExamReferral(
            'record-1',
            { exams: [{ name: 'RM joelho' }] } as any,
            'colaborador',
          ),
      ],
      [
        'pré-visualização do atestado',
        () =>
          service.previewMedicalCertificate(
            { clinicalRecordId: 'record-1', restDays: 3 } as any,
            'colaborador',
          ),
      ],
    ])(
      'bloqueia %s em nome de médico fora do acesso do usuário',
      async (_label, action) => {
        accessControlService.assertCanAccessDoctorResource.mockRejectedValue(
          new ForbiddenException(),
        );

        await expect(action()).rejects.toThrow(ForbiddenException);

        expect(doctorPdfContextService.buildForDoctorId).not.toHaveBeenCalled();
        expect(documentRepository.create).not.toHaveBeenCalled();
      },
    );

    it('falha quando a ficha não existe', async () => {
      clinicalRecordRepository.findOne.mockResolvedValue(null);

      await expect(
        service.generatePrescription(
          'sumida',
          prescriptionDto as any,
          'doctor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('atestado', () => {
    it('médico (CRM) emite ATESTADO MÉDICO', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        { restDays: 1 } as any,
        'doctor-1',
      );

      expect(
        pdfService.generateMedicalCertificatePdf.mock.calls[0][0]
          .certificateTitle,
      ).toBe('ATESTADO MÉDICO');
    });

    it('dentista (CRO) emite ATESTADO ODONTOLÓGICO com o registro CRO', async () => {
      doctorPdfContextService.buildForDoctorId.mockResolvedValue({
        doctor: { name: 'Dr. Bruno Dentista' },
        profile: { council: 'CRO', crm: '4321', crmState: 'RJ' },
        doctorCrm: 'CRO 4321/RJ',
        customHeader: null,
      });

      await service.generateMedicalCertificate(
        'record-1',
        { restDays: 2 } as any,
        'doctor-1',
      );

      expect(pdfService.generateMedicalCertificatePdf).toHaveBeenCalledWith(
        expect.objectContaining({
          certificateTitle: 'ATESTADO ODONTOLÓGICO',
          doctorCrm: 'CRO 4321/RJ',
        }),
      );
      expect(documentRepository.create).toHaveBeenCalled();
    });

    describe('texto livre + afastamento do formulário', () => {
      const emitir = (data: Record<string, unknown>) =>
        service.generateMedicalCertificate(
          'record-1',
          { clinicalRecordId: 'record-1', ...data } as any,
          'doctor-1',
        );
      const nota = () =>
        pdfService.generateMedicalCertificatePdf.mock.calls[0][0]
          .restPeriodNote;

      it('texto sem dias nem início ganha a linha com os dois', async () => {
        await emitir({
          text: 'Atesto que o paciente esteve em consulta.',
          restDays: 3,
          startDate: '2026-07-30',
        });
        expect(nota()).toBe('Afastamento de 3 dias, a partir de 30/07/2026.');
      });

      it('texto com {{dias}} (já impresso no lugar) ganha só o início', async () => {
        await emitir({
          text: 'Necessita de {{dias}} dias de repouso.',
          restDays: 3,
          startDate: '2026-07-30',
        });
        expect(nota()).toBe('Início do afastamento: 30/07/2026.');
      });

      it('texto com {{dias}} e {{inicio}} não ganha linha', async () => {
        await emitir({
          text: 'Repouso de {{DIAS}} a partir de {{inicio}}.',
          restDays: 3,
          startDate: '2026-07-30',
        });
        expect(nota()).toBeUndefined();
        expect(
          pdfService.generateMedicalCertificatePdf.mock.calls[0][0].text,
        ).toBe('Repouso de 3 a partir de 30/07/2026.');
      });

      it('"N dias" escrito no texto não esconde o afastamento', async () => {
        await emitir({
          text: 'Retorno em 3 dias para reavaliação.',
          restDays: 3,
        });
        expect(nota()).toBe('Afastamento de 3 dias.');
      });

      it('falar em comparecimento não decide nada: com dias, a linha entra', async () => {
        await emitir({
          text: 'Declaro que o paciente compareceu a esta consulta das 14h às 15h.',
          restDays: 1,
        });
        expect(nota()).toBe('Afastamento de 1 dia.');
      });

      it('atestado de comparecimento (sem dias) não ganha linha', async () => {
        await emitir({
          text: 'Declaro que o paciente compareceu e deve permanecer afastado.',
        });
        expect(nota()).toBeUndefined();
      });

      it('texto com {{dias}} sem dias informados é 400, não "por  dias"', async () => {
        await expect(
          emitir({ text: 'Afastado por {{dias}} dias.' }),
        ).rejects.toThrow(
          'O texto do atestado usa {{dias}}, mas os dias de afastamento não foram informados.',
        );
        expect(pdfService.generateMedicalCertificatePdf).not.toHaveBeenCalled();
      });

      it('texto com {{inicio}} sem afastamento também é 400', async () => {
        await expect(
          emitir({ text: 'A partir de {{ Inicio }}.' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('a prévia devolve o mesmo 400', async () => {
        await expect(
          service.previewMedicalCertificate(
            {
              clinicalRecordId: 'record-1',
              text: 'Afastado por {{dias}} dias a partir de {{inicio}}.',
            } as any,
            'doctor-1',
          ),
        ).rejects.toThrow(
          'O texto do atestado usa {{dias}} e {{inicio}}, mas os dias de afastamento não foram informados. Informe os dias de afastamento ou remova {{dias}} e {{inicio}} do texto.',
        );
        expect(pdfService.renderClinicalDocumentHtml).not.toHaveBeenCalled();
      });

      it('modelo com {{dias}} sem dias informados é 400', async () => {
        documentTemplatesService.getForUse.mockResolvedValue({
          id: 'tpl-1',
          kind: ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
          body: 'Afastado por {{dias}} dias.',
        });
        await expect(emitir({ templateId: 'tpl-1' })).rejects.toThrow(
          BadRequestException,
        );
      });
    });

    it('pluraliza o afastamento em dias', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        { restDays: 3, startDate: '2026-07-30' } as any,
        'doctor-1',
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
        'doctor-1',
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
        'doctor-1',
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
        'doctor-1',
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
        'doctor-1',
      );

      expect(pdfService.generateMedicalCertificatePdf).toHaveBeenCalledWith(
        expect.objectContaining({ cid: null }),
      );

      await service.generateMedicalCertificate(
        'record-1',
        { restDays: 2, includeCid: true } as any,
        'doctor-1',
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
        'doctor-1',
      );

      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: DOCUMENT_TYPES.medicalCertificate }),
      );
    });
  });

  describe('pré-visualização', () => {
    it('devolve o HTML do documento sem gravar nada', async () => {
      const html = await service.previewPrescription(
        { clinicalRecordId: 'record-1', ...prescriptionDto } as any,
        'doctor-1',
      );

      expect(html).toBe('<html>previa</html>');
      expect(storageService.create).not.toHaveBeenCalled();
      expect(documentRepository.create).not.toHaveBeenCalled();
    });

    it('não invoca o Puppeteer para pré-visualizar', async () => {
      await service.previewPrescription(
        { clinicalRecordId: 'record-1', ...prescriptionDto } as any,
        'doctor-1',
      );

      expect(pdfService.generatePrescriptionPdf).not.toHaveBeenCalled();
    });

    it('pré-visualiza a partir do mesmo template e dos mesmos dados da emissão', async () => {
      await service.previewPrescription(
        { clinicalRecordId: 'record-1', ...prescriptionDto } as any,
        'doctor-1',
      );
      const [template, previewData] =
        pdfService.renderClinicalDocumentHtml.mock.calls[0];

      await service.generatePrescription(
        'record-1',
        prescriptionDto as any,
        'doctor-1',
      );

      expect(template).toBe('prescription');
      expect(pdfService.generatePrescriptionPdf).toHaveBeenCalledWith(
        previewData,
      );
    });

    it('pré-visualiza atestado e encaminhamento pelos templates certos', async () => {
      await service.previewMedicalCertificate(
        { clinicalRecordId: 'record-1', restDays: 1 } as any,
        'doctor-1',
      );
      expect(pdfService.renderClinicalDocumentHtml).toHaveBeenLastCalledWith(
        'medical-certificate',
        expect.anything(),
      );

      await service.previewExamReferral(
        { clinicalRecordId: 'record-1', exams: [{ name: 'Hemograma' }] } as any,
        'doctor-1',
      );
      expect(pdfService.renderClinicalDocumentHtml).toHaveBeenLastCalledWith(
        'exam-referral',
        expect.anything(),
      );
      expect(documentRepository.create).not.toHaveBeenCalled();
    });

    it('recusa pré-visualizar ficha de outro tenant', async () => {
      accessControlService.assertCanAccessDoctorResource.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.previewPrescription(
          { clinicalRecordId: 'record-1', ...prescriptionDto } as any,
          'x',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('pré-visualização sem ficha gravada', () => {
    it('monta a receita a partir do paciente, sem tocar na ficha', async () => {
      const html = await service.previewPrescription(
        { patientId: 'patient-1', ...prescriptionDto } as any,
        'doctor-1',
      );

      expect(html).toBe('<html>previa</html>');
      expect(clinicalRecordRepository.findOne).not.toHaveBeenCalled();
      expect(documentRepository.create).not.toHaveBeenCalled();
      expect(storageService.create).not.toHaveBeenCalled();
      expect(pdfService.renderClinicalDocumentHtml).toHaveBeenCalledWith(
        'prescription',
        expect.objectContaining({
          patientName: 'Alessandro Filho',
          items: prescriptionDto.items,
        }),
      );
    });

    it('assina com o próprio usuário quando nenhum médico é informado', async () => {
      await service.previewPrescription(
        { patientId: 'patient-1', ...prescriptionDto } as any,
        'doctor-1',
      );

      expect(doctorPdfContextService.buildForDoctorId).toHaveBeenCalledWith(
        'doctor-1',
      );
    });

    it('confere clínica e vínculo e recusa pré-visualizar em nome de outro profissional', async () => {
      await expect(
        service.previewPrescription(
          {
            patientId: 'patient-1',
            doctorId: 'doctor-2',
            ...prescriptionDto,
          } as any,
          'doctor-1',
        ),
      ).rejects.toThrow(
        new ForbiddenException(
          'Só o profissional da consulta pode emitir este documento.',
        ),
      );

      expect(
        accessControlService.assertCanAccessDoctorResource,
      ).toHaveBeenCalledWith('doctor-1', 'owner-1', 'doctor-2');
      expect(doctorPdfContextService.buildForDoctorId).not.toHaveBeenCalled();
      expect(pdfService.renderClinicalDocumentHtml).not.toHaveBeenCalled();
    });

    it('doctorId igual ao próprio usuário pré-visualiza normalmente', async () => {
      await service.previewPrescription(
        {
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          ...prescriptionDto,
        } as any,
        'doctor-1',
      );
      expect(pdfService.renderClinicalDocumentHtml).toHaveBeenCalled();
    });

    it('recusa pré-visualizar em nome de médico fora do acesso do usuário', async () => {
      accessControlService.assertCanAccessDoctorResource.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.previewPrescription(
          {
            patientId: 'patient-1',
            doctorId: 'doctor-2',
            ...prescriptionDto,
          } as any,
          'intruso',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(pdfService.renderClinicalDocumentHtml).not.toHaveBeenCalled();
    });

    it('usa os CIDs enviados na prévia do atestado e do encaminhamento', async () => {
      const cidCodes = [{ code: 'S83.2', description: 'Ruptura do menisco' }];

      await service.previewMedicalCertificate(
        {
          patientId: 'patient-1',
          restDays: 2,
          includeCid: true,
          cidCodes,
        } as any,
        'doctor-1',
      );
      expect(pdfService.renderClinicalDocumentHtml).toHaveBeenLastCalledWith(
        'medical-certificate',
        expect.objectContaining({ cid: cidCodes[0] }),
      );

      await service.previewExamReferral(
        {
          patientId: 'patient-1',
          exams: [{ name: 'Hemograma' }],
          cidCodes,
        } as any,
        'doctor-1',
      );
      expect(pdfService.renderClinicalDocumentHtml).toHaveBeenLastCalledWith(
        'exam-referral',
        expect.objectContaining({ cidCodes }),
      );
    });

    it('exige ficha ou paciente', async () => {
      await expect(
        service.previewPrescription(prescriptionDto as any, 'doctor-1'),
      ).rejects.toThrow(BadRequestException);

      expect(clinicalRecordRepository.findOne).not.toHaveBeenCalled();
      expect(pdfService.renderClinicalDocumentHtml).not.toHaveBeenCalled();
    });

    it('bloqueia não-médico', async () => {
      accessControlService.assertCanIssueClinicalDocuments.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.previewPrescription(
          { patientId: 'patient-1', ...prescriptionDto } as any,
          'secretaria-id',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('produz os mesmos dados que a emissão a partir da ficha equivalente', async () => {
      await service.previewPrescription(
        {
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          ...prescriptionDto,
        } as any,
        'doctor-1',
      );
      const [, previewData] =
        pdfService.renderClinicalDocumentHtml.mock.calls[0];

      await service.generatePrescription(
        'record-1',
        prescriptionDto as any,
        'doctor-1',
      );

      expect(pdfService.generatePrescriptionPdf).toHaveBeenCalledWith(
        previewData,
      );
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
        'doctor-1',
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
        'doctor-1',
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
        'doctor-1',
      );

      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: DOCUMENT_TYPES.examReferral }),
      );
    });
  });

  describe('somente médico emite', () => {
    beforeEach(() => {
      accessControlService.assertCanIssueClinicalDocuments.mockRejectedValue(
        new ForbiddenException(),
      );
    });

    it.each([
      [
        'receita',
        () =>
          service.generatePrescription(
            'record-1',
            prescriptionDto as any,
            'secretaria-id',
          ),
      ],
      [
        'atestado',
        () =>
          service.generateMedicalCertificate(
            'record-1',
            { restDays: 2 } as any,
            'secretaria-id',
          ),
      ],
      [
        'encaminhamento',
        () =>
          service.generateExamReferral(
            'record-1',
            { exams: [{ name: 'Hemograma' }] } as any,
            'secretaria-id',
          ),
      ],
      [
        'prévia da receita',
        () =>
          service.previewPrescription(
            { clinicalRecordId: 'record-1', ...prescriptionDto } as any,
            'secretaria-id',
          ),
      ],
      [
        'prévia do atestado',
        () =>
          service.previewMedicalCertificate(
            { clinicalRecordId: 'record-1', restDays: 2 } as any,
            'secretaria-id',
          ),
      ],
      [
        'prévia do encaminhamento',
        () =>
          service.previewExamReferral(
            {
              clinicalRecordId: 'record-1',
              exams: [{ name: 'Hemograma' }],
            } as any,
            'secretaria-id',
          ),
      ],
    ])('bloqueia não-médico em %s', async (_label, action) => {
      await expect(action()).rejects.toThrow(ForbiddenException);

      expect(
        accessControlService.assertCanIssueClinicalDocuments,
      ).toHaveBeenCalledWith('secretaria-id');
      expect(documentRepository.create).not.toHaveBeenCalled();
      expect(pdfService.renderClinicalDocumentHtml).not.toHaveBeenCalled();
    });
  });
  describe('documento em nome de outro profissional', () => {
    beforeEach(() => {
      clinicalRecordRepository.findOne.mockResolvedValue({
        ...record,
        doctorId: 'doctor-2',
      });
    });

    it.each([
      [
        'receita',
        () =>
          service.generatePrescription(
            'record-1',
            prescriptionDto as any,
            'doctor-1',
          ),
      ],
      [
        'atestado',
        () =>
          service.generateMedicalCertificate(
            'record-1',
            { restDays: 2 } as any,
            'doctor-1',
          ),
      ],
      [
        'encaminhamento',
        () =>
          service.generateExamReferral(
            'record-1',
            { exams: [{ name: 'Hemograma' }] } as any,
            'doctor-1',
          ),
      ],
      [
        'prévia da receita',
        () =>
          service.previewPrescription(
            { clinicalRecordId: 'record-1', ...prescriptionDto } as any,
            'doctor-1',
          ),
      ],
      [
        'prévia do atestado',
        () =>
          service.previewMedicalCertificate(
            { clinicalRecordId: 'record-1', restDays: 2 } as any,
            'doctor-1',
          ),
      ],
      [
        'prévia do encaminhamento',
        () =>
          service.previewExamReferral(
            {
              clinicalRecordId: 'record-1',
              exams: [{ name: 'Hemograma' }],
            } as any,
            'doctor-1',
          ),
      ],
      [
        'aplicar modelo',
        () =>
          service.applyTemplate(
            'tpl-1',
            { clinicalRecordId: 'record-1' } as any,
            'doctor-1',
          ),
      ],
    ])('recusa %s com 403 e mensagem clara', async (_label, action) => {
      await expect(action()).rejects.toThrow(
        new ForbiddenException(
          'Só o profissional da consulta pode emitir este documento.',
        ),
      );
      expect(doctorPdfContextService.buildForDoctorId).not.toHaveBeenCalled();
      expect(documentTemplatesService.getForUse).not.toHaveBeenCalled();
      expect(documentRepository.create).not.toHaveBeenCalled();
      expect(pdfService.renderClinicalDocumentHtml).not.toHaveBeenCalled();
    });

    it('médico com CRM sem número (veio do Feegow assim) não emite nem pré-visualiza', async () => {
      clinicalRecordRepository.findOne.mockResolvedValue(record);
      doctorPdfContextService.buildForDoctorId.mockResolvedValue({
        doctor: { name: 'Karina Clínica' },
        profile: { council: 'CRM', crm: null },
        doctorCrm: undefined,
        customHeader: null,
      });

      await expect(
        service.previewPrescription(
          { clinicalRecordId: 'record-1', ...prescriptionDto } as any,
          'doctor-1',
        ),
      ).rejects.toThrow(
        'Preencha o número e a UF do CRM de Karina Clínica em Colaboradores antes de emitir documentos.',
      );
      expect(pdfService.generatePrescriptionPdf).not.toHaveBeenCalled();
    });

    it('registro sem UF também não emite', async () => {
      clinicalRecordRepository.findOne.mockResolvedValue(record);
      doctorPdfContextService.buildForDoctorId.mockResolvedValue({
        doctor: { name: 'Karina Clínica' },
        profile: { council: 'CRM', crm: '12345', crmState: null },
        doctorCrm: 'CRM 12345',
        customHeader: null,
      });

      await expect(
        service.generatePrescription(
          'record-1',
          prescriptionDto as any,
          'doctor-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(documentRepository.create).not.toHaveBeenCalled();
    });

    it('não checa de novo quando quem emite é o próprio médico da ficha', async () => {
      clinicalRecordRepository.findOne.mockResolvedValue(record);

      await service.previewPrescription(
        { clinicalRecordId: 'record-1', ...prescriptionDto } as any,
        'doctor-1',
      );

      expect(
        accessControlService.assertCanIssueClinicalDocuments,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('modelos de texto (MIG-06)', () => {
    const modeloAtestado = {
      id: 'tpl-1',
      kind: ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
      body: 'Atesto que {{paciente.nome}} (CPF {{paciente.cpf}}) precisa de {{dias}} dias. {{medico.nome}} — {{medico.registro}} {{desconhecido}}',
    };

    beforeEach(() => {
      documentTemplatesService.getForUse.mockResolvedValue(modeloAtestado);
      documentTemplatesService.incrementUsage.mockResolvedValue(undefined);
    });

    it('atestado com templateId e sem texto usa o modelo como texto do atestado', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        { clinicalRecordId: 'record-1', restDays: 3, templateId: 'tpl-1' },
        'doctor-1',
      );

      expect(documentTemplatesService.getForUse).toHaveBeenCalledWith(
        'tpl-1',
        ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
        'doctor-1',
        'doctor-1',
      );
      const pdfData = pdfService.generateMedicalCertificatePdf.mock.calls[0][0];
      expect(pdfData.text).toBe(
        'Atesto que Alessandro Filho (CPF 146.858.546-08) precisa de 3 dias. Dra. Ana Souza — CRM 12345/RJ {{desconhecido}}',
      );
      expect(pdfData.observations).toBeUndefined();
      expect(documentTemplatesService.incrementUsage).not.toHaveBeenCalled();
    });

    it('o texto enviado vence o modelo', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        {
          clinicalRecordId: 'record-1',
          templateId: 'tpl-1',
          text: 'Texto editado pelo médico',
          observations: 'Retornar em 7 dias',
        },
        'doctor-1',
      );

      expect(documentTemplatesService.getForUse).not.toHaveBeenCalled();
      const pdfData = pdfService.generateMedicalCertificatePdf.mock.calls[0][0];
      expect(pdfData.text).toBe('Texto editado pelo médico');
      expect(pdfData.observations).toBe('Retornar em 7 dias');
    });

    it('modelo escrito como o atestado inteiro perde o título e a assinatura que o PDF já imprime', async () => {
      documentTemplatesService.getForUse.mockResolvedValue({
        ...modeloAtestado,
        body: 'ATESTADO MÉDICO\n\nAtesto que {{paciente.nome}} precisa de {{dias}} dias.\n\n---\n\nDr.(a) {{medico.nome}}\nCRM {{medico.registro}}',
      });

      const aplicado = await service.applyTemplate(
        'tpl-1',
        { patientId: 'patient-1', restDays: 2 },
        'doctor-1',
      );
      await service.generateMedicalCertificate(
        'record-1',
        { clinicalRecordId: 'record-1', restDays: 2, templateId: 'tpl-1' },
        'doctor-1',
      );

      expect(aplicado.body).toBe(
        'Atesto que Alessandro Filho precisa de {{dias}} dias.',
      );
      expect(
        pdfService.generateMedicalCertificatePdf.mock.calls[0][0].text,
      ).toBe('Atesto que Alessandro Filho precisa de 2 dias.');
    });

    it('pedido de exame com modelo preenche a indicação clínica e pede o tipo certo', async () => {
      documentTemplatesService.getForUse.mockResolvedValue({
        id: 'tpl-2',
        kind: ClinicalDocumentTemplateKind.EXAM_REFERRAL,
        body: 'Investigação em {{paciente.nome}}, {{data}}',
      });

      await service.generateExamReferral(
        'record-1',
        {
          clinicalRecordId: 'record-1',
          exams: [{ name: 'RM joelho' }],
          templateId: 'tpl-2',
        },
        'doctor-1',
      );

      expect(documentTemplatesService.getForUse).toHaveBeenCalledWith(
        'tpl-2',
        ClinicalDocumentTemplateKind.EXAM_REFERRAL,
        'doctor-1',
        'doctor-1',
      );
      expect(
        pdfService.generateExamReferralPdf.mock.calls[0][0].clinicalIndication,
      ).toMatch(/^Investigação em Alessandro Filho, \d{2}\/\d{2}\/\d{4}$/);
    });

    it('pedido de exame: modelo escrito como documento inteiro entra na indicação clínica sem título nem assinatura', async () => {
      documentTemplatesService.getForUse.mockResolvedValue({
        id: 'tpl-2',
        kind: ClinicalDocumentTemplateKind.EXAM_REFERRAL,
        body: 'SOLICITAÇÃO DE EXAMES\n\nInvestigação de dor lombar em {{paciente.nome}}.\n\n___\nDr.(a) {{medico.nome}}\n{{medico.registro}}',
      });

      await service.generateExamReferral(
        'record-1',
        {
          clinicalRecordId: 'record-1',
          exams: [{ name: 'RM coluna lombar' }],
          templateId: 'tpl-2',
        },
        'doctor-1',
      );

      expect(
        pdfService.generateExamReferralPdf.mock.calls[0][0].clinicalIndication,
      ).toBe('Investigação de dor lombar em Alessandro Filho.');
    });

    it('modelo de outro tipo é recusado pela checagem do service de modelos', async () => {
      documentTemplatesService.getForUse.mockRejectedValue(
        new BadRequestException('Este modelo é de outro tipo de documento.'),
      );

      await expect(
        service.generateExamReferral(
          'record-1',
          {
            clinicalRecordId: 'record-1',
            exams: [{ name: 'RX' }],
            templateId: 'tpl-1',
          },
          'doctor-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(pdfService.generateExamReferralPdf).not.toHaveBeenCalled();
    });

    it('aplicar devolve o texto preenchido para o paciente da tela e conta o uso', async () => {
      const resultado = await service.applyTemplate(
        'tpl-1',
        { patientId: 'patient-1', restDays: 2 },
        'doctor-1',
      );

      expect(resultado).toEqual({
        id: 'tpl-1',
        kind: ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
        body: expect.stringContaining('Atesto que Alessandro Filho'),
      });
      expect(resultado.body).toContain('precisa de {{dias}} dias');
      expect(documentTemplatesService.incrementUsage).toHaveBeenCalledWith(
        'tpl-1',
      );
      expect(clinicalRecordRepository.findOne).not.toHaveBeenCalled();
    });

    it('reaplicar só para atualizar a tela (refresh) não conta outro uso', async () => {
      const resultado = await service.applyTemplate(
        'tpl-1',
        { patientId: 'patient-1', restDays: 5, refresh: true },
        'doctor-1',
      );

      expect(resultado.body).toContain('precisa de {{dias}} dias');
      expect(documentTemplatesService.incrementUsage).not.toHaveBeenCalled();
    });

    it('aplicar exige o mesmo que emitir: só médico com CRM', async () => {
      accessControlService.assertCanIssueClinicalDocuments.mockRejectedValueOnce(
        new ForbiddenException('Somente médicos (CRM)'),
      );

      await expect(
        service.applyTemplate('tpl-1', { patientId: 'patient-1' }, 'tec-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(documentTemplatesService.getForUse).not.toHaveBeenCalled();
      expect(documentTemplatesService.incrementUsage).not.toHaveBeenCalled();
    });

    it('o modelo tem que ser de quem assina: o service de modelos recebe o médico da ficha', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        { clinicalRecordId: 'record-1', restDays: 2, templateId: 'tpl-1' },
        'doctor-1',
      );
      await service.applyTemplate(
        'tpl-1',
        { patientId: 'patient-1', doctorId: 'doctor-1' },
        'doctor-1',
      );

      expect(documentTemplatesService.getForUse).toHaveBeenNthCalledWith(
        1,
        'tpl-1',
        ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
        'doctor-1',
        'doctor-1',
      );
      expect(documentTemplatesService.getForUse).toHaveBeenNthCalledWith(
        2,
        'tpl-1',
        null,
        'doctor-1',
        'doctor-1',
      );
    });

    it('pedido de exame com {{dias}}/{{inicio}} é 400 (emitir e prévia)', async () => {
      const dto = {
        clinicalRecordId: 'record-1',
        exams: [{ name: 'RX' }],
        clinicalIndication: 'Dor há {{dias}} dias',
      };
      const mensagem =
        'O pedido de exame não tem afastamento: remova {{dias}} do texto da indicação clínica.';

      await expect(
        service.generateExamReferral('record-1', dto as any, 'doctor-1'),
      ).rejects.toThrow(mensagem);
      await expect(
        service.previewExamReferral(dto as any, 'doctor-1'),
      ).rejects.toThrow(mensagem);
      expect(pdfService.generateExamReferralPdf).not.toHaveBeenCalled();
    });

    it('modelo de pedido de exame com {{inicio}} também é 400', async () => {
      documentTemplatesService.getForUse.mockResolvedValue({
        id: 'tpl-2',
        kind: ClinicalDocumentTemplateKind.EXAM_REFERRAL,
        body: 'Desde {{INICIO}}',
      });
      await expect(
        service.generateExamReferral(
          'record-1',
          {
            clinicalRecordId: 'record-1',
            exams: [{ name: 'RX' }],
            templateId: 'tpl-2',
          },
          'doctor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('aplicar antes de escolher o afastamento deixa {{dias}} e {{inicio}} para a emissão', async () => {
      documentTemplatesService.getForUse.mockResolvedValue({
        ...modeloAtestado,
        body: 'Atesto que {{paciente.nome}} precisa de {{dias}} dias a partir de {{inicio}}.',
      });

      const aplicado = await service.applyTemplate(
        'tpl-1',
        { patientId: 'patient-1' },
        'doctor-1',
      );
      expect(aplicado.body).toBe(
        'Atesto que Alessandro Filho precisa de {{dias}} dias a partir de {{inicio}}.',
      );

      await service.generateMedicalCertificate(
        'record-1',
        {
          clinicalRecordId: 'record-1',
          restDays: 4,
          startDate: '2026-07-30',
          text: aplicado.body,
        },
        'doctor-1',
      );
      const pdfData = pdfService.generateMedicalCertificatePdf.mock.calls[0][0];
      expect(pdfData.text).toBe(
        'Atesto que Alessandro Filho precisa de 4 dias a partir de 30/07/2026.',
      );
      expect(pdfData.restPeriodNote).toBeUndefined();
    });

    it('aplicar ignora dias/início da tela: o texto editado sai com o afastamento final', async () => {
      documentTemplatesService.getForUse.mockResolvedValue({
        ...modeloAtestado,
        body: 'Atesto que {{paciente.nome}} precisa de {{dias}} dias a partir de {{inicio}}.',
      });

      const aplicado = await service.applyTemplate(
        'tpl-1',
        { patientId: 'patient-1', restDays: 1, startDate: '2026-07-30' },
        'doctor-1',
      );
      expect(aplicado.body).toBe(
        'Atesto que Alessandro Filho precisa de {{dias}} dias a partir de {{inicio}}.',
      );

      await service.generateMedicalCertificate(
        'record-1',
        {
          clinicalRecordId: 'record-1',
          restDays: 3,
          startDate: '2026-07-30',
          text: `${aplicado.body} Retorno em consulta.`,
        },
        'doctor-1',
      );
      const pdfData = pdfService.generateMedicalCertificatePdf.mock.calls[0][0];
      expect(pdfData.text).toBe(
        'Atesto que Alessandro Filho precisa de 3 dias a partir de 30/07/2026. Retorno em consulta.',
      );
      expect(pdfData.restPeriodNote).toBeUndefined();
    });

    it('sem início escolhido, a emissão preenche {{inicio}} com a data de emissão', async () => {
      await service.generateMedicalCertificate(
        'record-1',
        {
          clinicalRecordId: 'record-1',
          restDays: 2,
          text: 'Afastado por {{dias}} dias a partir de {{inicio}}.',
        },
        'doctor-1',
      );
      expect(
        pdfService.generateMedicalCertificatePdf.mock.calls[0][0].text,
      ).toMatch(/^Afastado por 2 dias a partir de \d{2}\/\d{2}\/\d{4}\.$/);
    });
  });
});
