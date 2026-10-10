import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { SurgeryRequestWorkflowService } from './surgery-request-workflow.service';
import { SurgeryRequestBillingService } from './surgery-request-billing.service';
import { SurgeryRequestNotificationService } from './surgery-request-notification.service';
import { SurgeryRequestPdfAssemblyService } from './surgery-request-pdf-assembly.service';
import { SendAnalysisHandler } from './workflow/send-analysis.handler';
import { QuotaService } from 'src/modules/billing/services/quota.service';
import { AuthorizationHandler } from './workflow/authorization.handler';
import { SchedulingHandler } from './workflow/scheduling.handler';
import { ExecutionHandler } from './workflow/execution.handler';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { ContestationRepository } from 'src/database/repositories/contestation.repository';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { SendMethod } from 'src/shared/constants/send-method';
import { MailService } from 'src/shared/mail/mail.service';
import { PdfGenerationService } from 'src/shared/pdf/pdf-generation.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { PendencyValidatorService } from 'src/modules/surgery-requests/pendencies/pendency-validator.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SurgeryRequestActivityRepository } from 'src/database/repositories/surgery-request-activity.repository';
import { SchedulingSelectionStore } from './workflow/scheduling-selection.store';
import { SURGERY_REQUEST_EVENTS } from '../events/surgery-request.events';

import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';

function makeRequest(overrides: Partial<SurgeryRequest> = {}): SurgeryRequest {
  return {
    id: 'req-1',
    status: SurgeryRequestStatus.PENDING,
    doctorId: 'doctor-1',
    doctor: {
      id: 'doctor-1',
      doctorProfile: {
        signatureUrl: 'signatures/doctor-1.png',
      },
    },
    createdById: 'user-1',
    patientId: 'patient-1',
    hospitalId: 'hospital-1',
    healthPlanId: 'hp-1',
    createdBy: { id: 'user-1', name: 'Dr. Test' },
    patient: { id: 'patient-1', name: 'Paciente Test' },
    hospital: { id: 'hospital-1', name: 'Hospital Test' },
    healthPlan: { id: 'hp-1', name: 'Plano Test' },
    tussItems: [{ id: 't1', tussCode: '123', name: 'Proc', quantity: 1 }],
    opmeItems: [],
    documents: [],
    analysis: null,
    billing: null,
    contestations: [],
    ...overrides,
  } as unknown as SurgeryRequest;
}

function createMockManager() {
  const repos: Record<string, any> = {};
  const getRepository = jest.fn((entity: any) => {
    const name = entity.name || 'default';
    if (!repos[name]) {
      repos[name] = {
        save: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockResolvedValue(null),
      };
    }
    return repos[name];
  });
  return { getRepository, repos };
}

describe('SurgeryRequestWorkflowService', () => {
  let service: SurgeryRequestWorkflowService;
  let surgeryRequestRepository: { [K: string]: jest.Mock };
  let mailService: { [K: string]: jest.Mock };
  let pdfGenerationService: { [K: string]: jest.Mock };
  let notificationService: { [K: string]: jest.Mock };
  let pdfAssemblyService: { [K: string]: jest.Mock };
  let billingService: { [K: string]: jest.Mock };
  let pendencyValidator: { [K: string]: jest.Mock };
  let contestationRepository: { [K: string]: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let activityRepository: { create: jest.Mock };
  let selectionStore: { find: jest.Mock; remember: jest.Mock };
  let quotaService: { consumeSurgeryRequest: jest.Mock };
  let documentRepository: { findMany: jest.Mock; findOne: jest.Mock };
  let storageService: {
    download: jest.Mock;
    getSignedUrl: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    surgeryRequestRepository = {
      findOneWithRelations: jest.fn(),
      findOneWithAllRelations: jest.fn(),
      findOneSimple: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      recordStatusChange: jest.fn().mockResolvedValue(undefined),
      applyStatusTransition: jest.fn().mockResolvedValue(true),
      updateIfStatus: jest.fn().mockResolvedValue(true),
      findInSchedulingByPatientPhones: jest.fn().mockResolvedValue([]),
    };
    surgeryRequestRepository.findOneForWorkflow = jest.fn((where) =>
      surgeryRequestRepository.findOneWithAllRelations(where),
    );
    surgeryRequestRepository.findOneForBilling = jest.fn((where) =>
      surgeryRequestRepository.findOneWithAllRelations(where),
    );
    eventEmitter = { emit: jest.fn() };
    documentRepository = {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { key: 'surgery_room' },
          { key: 'surgery_auth_document' },
        ]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    activityRepository = { create: jest.fn().mockResolvedValue({}) };
    selectionStore = {
      find: jest.fn().mockResolvedValue(null),
      remember: jest.fn().mockResolvedValue(undefined),
    };

    mailService = {
      sendSurgeryRequestSent: jest.fn().mockResolvedValue(undefined),
      sendSurgeryContested: jest.fn().mockResolvedValue(undefined),
      sendPaymentContested: jest.fn().mockResolvedValue(undefined),
    };

    pdfGenerationService = {
      scheduleGeneration: jest.fn(),
    };

    notificationService = {
      notifyPatientIfRequested: jest.fn().mockResolvedValue(undefined),
      notifyPatientSchedulingOptions: jest.fn().mockResolvedValue(undefined),
      notifyAdminsOfWorkflowAction: jest.fn().mockResolvedValue(undefined),
      notifyStakeholdersOfStatusChange: jest.fn().mockResolvedValue(undefined),
      notify: jest.fn().mockResolvedValue(undefined),
    };

    pdfAssemblyService = {
      generateLaudoPdf: jest
        .fn()
        .mockResolvedValue({ pdf: Buffer.from('pdf').toString('base64') }),
      generateContestAuthorizationPdf: jest
        .fn()
        .mockResolvedValue(Buffer.from('pdf')),
    };

    storageService = {
      download: jest.fn().mockResolvedValue(Buffer.from('source-doc')),
      getSignedUrl: jest.fn(),
      delete: jest.fn(),
    };

    billingService = {
      invoiceRequest: jest.fn().mockResolvedValue(undefined),
      confirmReceipt: jest.fn().mockResolvedValue({ hasDivergence: false }),
      contestPayment: jest.fn().mockResolvedValue(undefined),
      updateReceipt: jest.fn().mockResolvedValue(undefined),
    };

    pendencyValidator = {
      assertCanAdvance: jest.fn().mockResolvedValue(undefined),
    };

    contestationRepository = {
      create: jest.fn().mockResolvedValue({}),
    };

    dataSource = {
      transaction: jest.fn(async (cb: (manager: any) => Promise<any>) => {
        const mockManager = createMockManager();
        return cb(mockManager);
      }),
      getRepository: jest.fn().mockReturnValue({
        save: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurgeryRequestWorkflowService,
        SendAnalysisHandler,
        AuthorizationHandler,
        SchedulingHandler,
        ExecutionHandler,
        { provide: DataSource, useValue: dataSource },
        { provide: MailService, useValue: mailService },
        { provide: PdfGenerationService, useValue: pdfGenerationService },
        {
          provide: SurgeryRequestRepository,
          useValue: surgeryRequestRepository,
        },
        {
          provide: ContestationRepository,
          useValue: contestationRepository,
        },
        {
          provide: SurgeryRequestNotificationService,
          useValue: notificationService,
        },
        {
          provide: SurgeryRequestPdfAssemblyService,
          useValue: pdfAssemblyService,
        },
        { provide: SurgeryRequestBillingService, useValue: billingService },
        {
          provide: PendencyValidatorService,
          useValue: pendencyValidator,
        },
        {
          provide: StorageService,
          useValue: storageService,
        },
        {
          provide: DocumentRepository,
          useValue: documentRepository,
        },
        { provide: EventEmitter2, useValue: eventEmitter },
        {
          provide: SurgeryRequestActivityRepository,
          useValue: activityRepository,
        },
        { provide: SchedulingSelectionStore, useValue: selectionStore },
        {
          provide: QuotaService,
          useValue: {
            consumeSurgeryRequest: jest.fn().mockResolvedValue({
              used: 1,
              limit: 30,
              isUnlimited: false,
              remaining: 29,
              periodStart: new Date(),
              periodEnd: new Date(Date.now() + 30 * 86400000),
            }),
            assertCanSendSurgeryRequest: jest.fn().mockResolvedValue(undefined),
            getQuotaSnapshot: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get(SurgeryRequestWorkflowService);
    quotaService = module.get(QuotaService);
  });

  describe('sendRequest', () => {
    it('should throw NotFoundException when request not found', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(null);

      await expect(
        service.sendRequest(
          'non-existent',
          { method: SendMethod.DOWNLOAD },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when assertCanAdvance blocks the transition', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );
      pendencyValidator.assertCanAdvance.mockRejectedValue(
        new BadRequestException({
          message: 'Existem pendências que impedem o avanço de status.',
          pendencies: [{ key: 'medical_report', name: 'Laudo Médico' }],
        }),
      );

      await expect(
        service.sendRequest('req-1', { method: SendMethod.DOWNLOAD }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed and return download when method is download', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      const result = await service.sendRequest(
        'req-1',
        { method: SendMethod.DOWNLOAD },
        'user-1',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(
        notificationService.notifyPatientIfRequested,
      ).not.toHaveBeenCalled();
      expect(pdfGenerationService.scheduleGeneration).toHaveBeenCalledWith(
        'req-1',
        'user-1',
      );
      expect(pdfAssemblyService.generateLaudoPdf).toHaveBeenCalled();
    });

    it('should send email when method is email with destination', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      const result = await service.sendRequest(
        'req-1',
        { method: SendMethod.EMAIL, to: 'test@test.com' },
        'user-1',
      );

      expect(mailService.sendSurgeryRequestSent).toHaveBeenCalledWith(
        'test@test.com',
        expect.objectContaining({ patientName: 'Paciente Test' }),
        [
          expect.objectContaining({
            filename: expect.stringContaining('solicitacao-'),
            contentType: 'application/pdf',
          }),
        ],
        undefined,
      );
      expect(result).toEqual({ sent: true, method: SendMethod.EMAIL });
    });

    it('should confirm with source document when method is document', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      const result = await service.sendRequest(
        'req-1',
        { method: SendMethod.DOCUMENT },
        'user-1',
      );

      expect(result).toEqual({ sent: true, method: SendMethod.DOCUMENT });
      expect(pdfAssemblyService.generateLaudoPdf).not.toHaveBeenCalled();
      expect(mailService.sendSurgeryRequestSent).not.toHaveBeenCalled();
    });

    it('usa a data informada (sentAt) para sentAt e lastStatusChangedAt quando method é document', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await service.sendRequest(
        'req-1',
        { method: SendMethod.DOCUMENT, sentAt: '2026-01-10' },
        'user-1',
      );

      const expectedDate = new Date(Date.UTC(2026, 0, 10, 12, 0, 0));
      expect(
        surgeryRequestRepository.applyStatusTransition,
      ).toHaveBeenCalledWith(expect.anything(), {
        id: 'req-1',
        from: request.status,
        to: SurgeryRequestStatus.SENT,
        data: expect.objectContaining({ sentAt: expectedDate }),
        userId: 'user-1',
        statusChangedAt: expectedDate,
      });
    });

    it('rejeita sentAt no futuro', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const futureDateStr = futureDate.toISOString().slice(0, 10);

      await expect(
        service.sendRequest(
          'req-1',
          { method: SendMethod.DOCUMENT, sentAt: futureDateStr },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('aceita a data de hoje antes das 09:00 de São Paulo', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
      try {
        const request = makeRequest();
        surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
          request,
        );

        await expect(
          service.sendRequest(
            'req-1',
            { method: SendMethod.DOCUMENT, sentAt: '2026-06-10' },
            'user-1',
          ),
        ).resolves.toEqual(
          expect.objectContaining({ method: SendMethod.DOCUMENT }),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('ignora sentAt quando o método não é document', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      const before = Date.now();
      await service.sendRequest(
        'req-1',
        { method: SendMethod.DOWNLOAD, sentAt: '2020-01-01' },
        'user-1',
      );

      const [, params] =
        surgeryRequestRepository.applyStatusTransition.mock.calls[0];
      expect(params.data.sentAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('rejeita sentAt inválido', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await expect(
        service.sendRequest(
          'req-1',
          { method: SendMethod.DOCUMENT, sentAt: 'lixo' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should email source document when useSourceDocument is true', async () => {
      const request = makeRequest({
        documents: [
          {
            id: 'doc-source',
            key: 'sc_creation_source',
            name: 'laudo-origem.pdf',
            uri: 'documents/owner/laudo-origem.pdf',
          },
        ] as any,
      });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      const result = await service.sendRequest(
        'req-1',
        {
          method: SendMethod.EMAIL,
          to: 'convenio@test.com',
          useSourceDocument: true,
        },
        'user-1',
      );

      expect(storageService.download).toHaveBeenCalledWith(
        'documents/owner/laudo-origem.pdf',
      );
      expect(pdfAssemblyService.generateLaudoPdf).not.toHaveBeenCalled();
      expect(mailService.sendSurgeryRequestSent).toHaveBeenCalledWith(
        'convenio@test.com',
        expect.objectContaining({ patientName: 'Paciente Test' }),
        [
          expect.objectContaining({
            filename: 'laudo-origem.pdf',
            content: Buffer.from('source-doc'),
          }),
        ],
        undefined,
      );
      expect(result).toEqual({ sent: true, method: SendMethod.EMAIL });
    });

    it('should throw when status is not PENDING', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await expect(
        service.sendRequest('req-1', { method: SendMethod.DOWNLOAD }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('startAnalysis', () => {
    it('should throw when status is not SENT', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.PENDING });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await expect(
        service.startAnalysis(
          'req-1',
          { requestNumber: '123', receivedAt: new Date().toISOString() },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when status is SENT', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.SENT });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await service.startAnalysis(
        'req-1',
        { requestNumber: 'REQ-001', receivedAt: '2026-01-15T00:00:00Z' },
        'user-1',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(
        notificationService.notifyPatientIfRequested,
      ).not.toHaveBeenCalled();
    });
  });

  describe('acceptAuthorization', () => {
    it('should throw when status is not IN_ANALYSIS', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.PENDING });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await expect(
        service.acceptAuthorization(
          'req-1',
          { dateOptions: ['2026-03-01'] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when status is IN_ANALYSIS', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await service.acceptAuthorization(
        'req-1',
        { dateOptions: ['2026-03-01', '2026-03-05'] },
        'user-1',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(
        notificationService.notifyPatientSchedulingOptions,
      ).not.toHaveBeenCalled();
      expect(
        notificationService.notifyStakeholdersOfStatusChange,
      ).toHaveBeenCalledWith(
        request,
        SurgeryRequestStatus.IN_ANALYSIS,
        SurgeryRequestStatus.IN_SCHEDULING,
        'user-1',
        { sendWhatsapp: false },
      );
    });

    it('should notify patient scheduling options when notifyPatient is true', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );
      const dateOptions = [
        '2026-03-01T10:00:00.000Z',
        '2026-03-05T14:00:00.000Z',
        '2026-03-08T09:00:00.000Z',
      ];

      await service.acceptAuthorization(
        'req-1',
        { dateOptions, notifyPatient: true },
        'user-1',
      );

      expect(
        notificationService.notifyPatientSchedulingOptions,
      ).toHaveBeenCalledWith(request, dateOptions);
    });

    it('should not notify patient scheduling options when notifyPatient is false', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );
      const dateOptions = [
        '2026-03-01T10:00:00.000Z',
        '2026-03-05T14:00:00.000Z',
        '2026-03-08T09:00:00.000Z',
      ];

      await service.acceptAuthorization(
        'req-1',
        { dateOptions, notifyPatient: false },
        'user-1',
      );

      expect(
        notificationService.notifyPatientSchedulingOptions,
      ).not.toHaveBeenCalled();
    });
  });

  describe('contestAuthorization', () => {
    it('should throw when status is not IN_ANALYSIS', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.SENT });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await expect(
        service.contestAuthorization(
          'req-1',
          { reason: 'Negado', method: SendMethod.EMAIL, to: 'a@b.com' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should save contestation and send email when method is email', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );
      let capturedManager: ReturnType<typeof createMockManager> | null = null;
      dataSource.transaction.mockImplementationOnce(
        async (cb: (manager: any) => Promise<any>) => {
          capturedManager = createMockManager();
          return cb(capturedManager);
        },
      );

      const result = await service.contestAuthorization(
        'req-1',
        {
          reason: 'Negado pelo plano',
          method: SendMethod.EMAIL,
          to: 'plano@test.com',
        },
        'user-1',
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      const contestationRepo = capturedManager!.repos.Contestation;
      expect(contestationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          surgeryRequestId: 'req-1',
          type: 'authorization',
          reason: 'Negado pelo plano',
        }),
      );
      expect(
        capturedManager!.repos.SurgeryRequestActivity.save,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Autorização contestada.' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SURGERY_REQUEST_EVENTS.UPDATED,
        { surgeryRequestId: 'req-1', actorId: 'user-1' },
      );
      expect(mailService.sendSurgeryContested).toHaveBeenCalled();
      expect(result).toEqual({ sent: true, method: SendMethod.EMAIL });
    });
  });

  describe('confirmDate', () => {
    it('should throw when status is not IN_SCHEDULING', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await expect(
        service.confirmDate('req-1', { selectedDateIndex: 0 }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when date index is invalid', async () => {
      const request = makeRequest({
        status: SurgeryRequestStatus.IN_SCHEDULING,
        dateOptions: ['2026-03-01'],
      });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await expect(
        service.confirmDate('req-1', { selectedDateIndex: 2 as any }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed with valid date index', async () => {
      const request = makeRequest({
        status: SurgeryRequestStatus.IN_SCHEDULING,
        dateOptions: ['2026-03-01', '2026-03-10'],
      });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await service.confirmDate('req-1', { selectedDateIndex: 0 }, 'user-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(
        notificationService.notifyPatientIfRequested,
      ).not.toHaveBeenCalled();
    });
  });

  describe('updateDateOptions', () => {
    it('should throw when status is not IN_SCHEDULING', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.SENT }),
      );

      await expect(
        service.updateDateOptions(
          'req-1',
          { dateOptions: ['2026-04-01'] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update date options successfully', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.IN_SCHEDULING }),
      );

      await service.updateDateOptions(
        'req-1',
        { dateOptions: ['2026-04-01', '2026-04-10'] },
        'user-1',
      );

      expect(surgeryRequestRepository.updateIfStatus).toHaveBeenCalledWith(
        'req-1',
        SurgeryRequestStatus.IN_SCHEDULING,
        { dateOptions: ['2026-04-01', '2026-04-10'] },
      );
      expect(
        notificationService.notifyPatientSchedulingOptions,
      ).not.toHaveBeenCalled();
    });

    it('should notify patient scheduling options when notifyPatient is true', async () => {
      const request = makeRequest({
        status: SurgeryRequestStatus.IN_SCHEDULING,
      });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );
      const dateOptions = [
        '2026-04-01T10:00:00.000Z',
        '2026-04-10T14:00:00.000Z',
        '2026-04-12T09:00:00.000Z',
      ];

      await service.updateDateOptions(
        'req-1',
        { dateOptions, notifyPatient: true },
        'user-1',
      );

      expect(
        notificationService.notifyPatientSchedulingOptions,
      ).toHaveBeenCalledWith(request, dateOptions);
    });
  });

  describe('reschedule', () => {
    it('should throw when status is not SCHEDULED', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.IN_SCHEDULING }),
      );

      await expect(
        service.reschedule('req-1', { newDate: '2026-05-01' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update surgery date when scheduled', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.SCHEDULED }),
      );

      await service.reschedule('req-1', { newDate: '2026-05-01' }, 'user-1');

      expect(surgeryRequestRepository.updateIfStatus).toHaveBeenCalledWith(
        'req-1',
        SurgeryRequestStatus.SCHEDULED,
        expect.objectContaining({ surgeryDate: expect.any(Date) }),
      );
    });
  });

  describe('markPerformed', () => {
    it('should throw when status is not SCHEDULED', async () => {
      const request = makeRequest({
        status: SurgeryRequestStatus.IN_SCHEDULING,
      });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await expect(
        service.markPerformed(
          'req-1',
          { surgeryPerformedAt: '2026-03-15T10:00:00Z' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when status is SCHEDULED', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.SCHEDULED });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await service.markPerformed(
        'req-1',
        { surgeryPerformedAt: '2026-03-15T10:00:00Z' },
        'user-1',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(
        notificationService.notifyStakeholdersOfStatusChange,
      ).toHaveBeenCalled();
    });
  });

  describe('invoiceRequest', () => {
    it('should delegate to billingService', async () => {
      const dto = {
        invoiceProtocol: 'INV-001',
        invoiceSentAt: '2026-04-01',
        invoiceValue: 5000,
      };

      await service.invoiceRequest('req-1', dto, 'user-1');

      expect(billingService.invoiceRequest).toHaveBeenCalledWith(
        'req-1',
        dto,
        'user-1',
      );
    });
  });

  describe('confirmReceipt', () => {
    it('should delegate to billingService', async () => {
      const dto = {
        receivedValue: 5000,
        receivedAt: '2026-04-15',
      };

      await service.confirmReceipt('req-1', dto, 'user-1');

      expect(billingService.confirmReceipt).toHaveBeenCalledWith(
        'req-1',
        dto,
        'user-1',
      );
    });
  });

  describe('contestPayment', () => {
    it('should delegate to billingService', async () => {
      const dto = {
        to: 'finance@test.com',
        subject: 'Contestação',
        message: 'Valor divergente',
      };

      await service.contestPayment('req-1', dto, 'user-1');

      expect(billingService.contestPayment).toHaveBeenCalledWith(
        'req-1',
        dto,
        'user-1',
      );
    });
  });

  describe('closeSurgeryRequest', () => {
    it('should throw when request not found', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(null);

      await expect(
        service.closeSurgeryRequest('req-1', { reason: 'Cancelado' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw when status is FINALIZED (not closeable)', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.FINALIZED }),
      );

      await expect(
        service.closeSurgeryRequest('req-1', { reason: 'Cancelado' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when status is already CLOSED', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.CLOSED }),
      );

      await expect(
        service.closeSurgeryRequest('req-1', { reason: 'Cancelado' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when status is PENDING', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.PENDING }),
      );

      await service.closeSurgeryRequest(
        'req-1',
        { reason: 'Desistiu' },
        'user-1',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(
        surgeryRequestRepository.applyStatusTransition,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'req-1',
          from: SurgeryRequestStatus.PENDING,
          to: SurgeryRequestStatus.CLOSED,
          userId: 'user-1',
          note: 'Desistiu',
        }),
      );
    });

    it('should succeed when status is IN_ANALYSIS', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS }),
      );

      await service.closeSurgeryRequest(
        'req-1',
        { reason: 'Cancelado' },
        'user-1',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should succeed with no reason (optional field)', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.PENDING }),
      );

      await service.closeSurgeryRequest('req-1', {}, 'user-1');

      expect(
        surgeryRequestRepository.applyStatusTransition,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          from: SurgeryRequestStatus.PENDING,
          to: SurgeryRequestStatus.CLOSED,
          note: undefined,
        }),
      );
    });
  });

  describe('notify', () => {
    it('should delegate to notificationService', async () => {
      await service.notify(
        'req-1',
        { template: 'surgery-scheduled' },
        'user-1',
      );

      expect(notificationService.notify).toHaveBeenCalledWith(
        'req-1',
        { template: 'surgery-scheduled' },
        'user-1',
      );
    });
  });

  describe('B8 — envio: validação antes da escrita, cota na transação, UPDATE condicional', () => {
    it('recusa anexo de outra SC antes de qualquer escrita (sem transação, sem cota)', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest(),
      );
      documentRepository.findOne.mockResolvedValue({
        id: 'doc-x',
        uri: 'documents/x.pdf',
        surgeryRequestId: 'outra-sc',
      });

      await expect(
        service.sendRequest(
          'req-1',
          {
            method: SendMethod.EMAIL,
            to: 'plano@test.com',
            attachments: ['doc-x'],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(quotaService.consumeSurgeryRequest).not.toHaveBeenCalled();
    });

    it('recusa documento de origem ausente antes de mudar o status', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest({ documents: [] }),
      );

      await expect(
        service.sendRequest(
          'req-1',
          {
            method: SendMethod.EMAIL,
            to: 'plano@test.com',
            useSourceDocument: true,
          },
          'user-1',
        ),
      ).rejects.toThrow('Documento de origem não encontrado');

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(quotaService.consumeSurgeryRequest).not.toHaveBeenCalled();
    });

    it('consome a cota DENTRO da transação, depois da troca de status', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest(),
      );
      const order: string[] = [];
      surgeryRequestRepository.applyStatusTransition.mockImplementation(
        async () => {
          order.push('status');
          return true;
        },
      );
      quotaService.consumeSurgeryRequest.mockImplementation(async () => {
        order.push('quota');
        return {};
      });
      dataSource.transaction.mockImplementationOnce(async (cb: any) => {
        order.push('begin');
        const result = await cb(createMockManager());
        order.push('commit');
        return result;
      });

      await service.sendRequest(
        'req-1',
        { method: SendMethod.DOWNLOAD },
        'user-1',
      );

      expect(order).toEqual(['begin', 'status', 'quota', 'commit']);
    });

    it('commit falha depois do consumo: a cota foi gravada pelo manager da transação e nada é disparado', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest(),
      );
      const txManager = createMockManager();
      dataSource.transaction.mockImplementationOnce(async (cb: any) => {
        await cb(txManager);
        throw new Error('commit failed');
      });

      await expect(
        service.sendRequest('req-1', { method: SendMethod.DOWNLOAD }, 'user-1'),
      ).rejects.toThrow('commit failed');

      expect(quotaService.consumeSurgeryRequest).toHaveBeenCalledWith(
        makeRequest().ownerId,
        { manager: txManager },
      );
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(
        notificationService.notifyStakeholdersOfStatusChange,
      ).not.toHaveBeenCalled();
    });

    it('cota recusada desfaz o envio: sem evento nem notificação', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest(),
      );
      quotaService.consumeSurgeryRequest.mockRejectedValue(
        new BadRequestException('limite'),
      );

      await expect(
        service.sendRequest('req-1', { method: SendMethod.DOWNLOAD }, 'user-1'),
      ).rejects.toThrow('limite');

      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(
        notificationService.notifyStakeholdersOfStatusChange,
      ).not.toHaveBeenCalled();
    });

    it('clique duplo: UPDATE condicional sem linha afetada vira 409 e não consome cota', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest(),
      );
      surgeryRequestRepository.applyStatusTransition.mockResolvedValue(false);

      await expect(
        service.sendRequest('req-1', { method: SendMethod.DOWNLOAD }, 'user-1'),
      ).rejects.toThrow(ConflictException);

      expect(quotaService.consumeSurgeryRequest).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('emite surgery-request.status_changed depois do commit', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest(),
      );

      await service.sendRequest(
        'req-1',
        { method: SendMethod.DOWNLOAD },
        'user-1',
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SURGERY_REQUEST_EVENTS.STATUS_CHANGED,
        {
          surgeryRequestId: 'req-1',
          from: SurgeryRequestStatus.PENDING,
          to: SurgeryRequestStatus.SENT,
          actorId: 'user-1',
        },
      );
    });
  });

  describe('UPDATE condicional nos demais handlers', () => {
    it.each([
      [
        'startAnalysis',
        SurgeryRequestStatus.SENT,
        (svc: SurgeryRequestWorkflowService) =>
          svc.startAnalysis(
            'req-1',
            { requestNumber: '1', receivedAt: '2026-01-01' } as any,
            'user-1',
          ),
      ],
      [
        'acceptAuthorization',
        SurgeryRequestStatus.IN_ANALYSIS,
        (svc: SurgeryRequestWorkflowService) =>
          svc.acceptAuthorization(
            'req-1',
            { dateOptions: ['2026-04-01'] } as any,
            'user-1',
          ),
      ],
      [
        'markPerformed',
        SurgeryRequestStatus.SCHEDULED,
        (svc: SurgeryRequestWorkflowService) =>
          svc.markPerformed(
            'req-1',
            { surgeryPerformedAt: '2026-01-01' } as any,
            'user-1',
          ),
      ],
    ])(
      '%s recusa com 409 quando outra ação já moveu a SC',
      async (_n, status, run) => {
        surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
          makeRequest({ status, dateOptions: ['2026-04-01'] }),
        );
        surgeryRequestRepository.applyStatusTransition.mockResolvedValue(false);

        await expect(run(service)).rejects.toThrow(ConflictException);
        expect(eventEmitter.emit).not.toHaveBeenCalled();
        expect(
          notificationService.notifyStakeholdersOfStatusChange,
        ).not.toHaveBeenCalled();
      },
    );

    it('updateDateOptions recusa com 409 quando a SC saiu de Em Agendamento', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.IN_SCHEDULING }),
      );
      surgeryRequestRepository.updateIfStatus.mockResolvedValue(false);

      await expect(
        service.updateDateOptions(
          'req-1',
          { dateOptions: ['2026-04-01'], notifyPatient: true },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(
        notificationService.notifyPatientSchedulingOptions,
      ).not.toHaveBeenCalled();
    });

    it('startAnalysis passa pela máquina de estados (erro com pendencies)', async () => {
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.PENDING }),
      );

      await expect(
        service.startAnalysis(
          'req-1',
          { requestNumber: '1', receivedAt: '2026-01-01' } as any,
          'user-1',
        ),
      ).rejects.toMatchObject({
        response: { pendencies: expect.any(Array) },
      });
    });
  });
});
