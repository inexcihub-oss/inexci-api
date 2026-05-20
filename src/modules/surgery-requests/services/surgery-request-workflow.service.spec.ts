import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

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

import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { ReportSection } from 'src/database/entities/report-section.entity';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<SurgeryRequest> = {}): SurgeryRequest {
  return {
    id: 'req-1',
    status: SurgeryRequestStatus.PENDING,
    doctorId: 'doctor-1',
    createdById: 'user-1',
    patientId: 'patient-1',
    hospitalId: 'hospital-1',
    healthPlanId: 'hp-1',
    createdBy: { id: 'user-1', name: 'Dr. Test' },
    doctor: {
      id: 'doctor-1',
      name: 'Dr. Test',
      doctorProfile: { signatureUrl: 'https://example.com/signature.png' },
    },
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

// ── Suite ────────────────────────────────────────────────────────────────────

describe('SurgeryRequestWorkflowService', () => {
  let service: SurgeryRequestWorkflowService;
  let surgeryRequestRepository: { [K: string]: jest.Mock };
  let mailService: { [K: string]: jest.Mock };
  let pdfGenerationService: { [K: string]: jest.Mock };
  let notificationService: { [K: string]: jest.Mock };
  let pdfAssemblyService: { [K: string]: jest.Mock };
  let billingService: { [K: string]: jest.Mock };
  let reportSectionRepo: { [K: string]: jest.Mock };
  let contestationRepository: { [K: string]: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    surgeryRequestRepository = {
      findOneWithRelations: jest.fn(),
      findOneWithAllRelations: jest.fn(),
      findOneSimple: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      recordStatusChange: jest.fn().mockResolvedValue(undefined),
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
      notifyAdminsOfWorkflowAction: jest.fn().mockResolvedValue(undefined),
      notifyStakeholdersOfStatusChange: jest.fn().mockResolvedValue(undefined),
      notify: jest.fn().mockResolvedValue(undefined),
    };

    pdfAssemblyService = {
      generateLaudoPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
      generateContestAuthorizationPdf: jest
        .fn()
        .mockResolvedValue(Buffer.from('pdf')),
    };

    billingService = {
      invoiceRequest: jest.fn().mockResolvedValue(undefined),
      confirmReceipt: jest.fn().mockResolvedValue({ hasDivergence: false }),
      contestPayment: jest.fn().mockResolvedValue(undefined),
      updateReceipt: jest.fn().mockResolvedValue(undefined),
    };

    reportSectionRepo = {
      count: jest.fn(),
    };

    contestationRepository = {
      create: jest.fn().mockResolvedValue({}),
    };

    // Mock DataSource.transaction to execute the callback with a mock manager
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
          provide: getRepositoryToken(ReportSection),
          useValue: reportSectionRepo,
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
          provide: StorageService,
          useValue: { getSignedUrl: jest.fn(), delete: jest.fn() },
        },
        {
          provide: DocumentRepository,
          useValue: {
            findMany: jest
              .fn()
              .mockResolvedValue([
                { key: 'surgery_room' },
                { key: 'surgery_auth_document' },
              ]),
          },
        },
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
  });

  // ── sendRequest (PENDING → SENT) ──────────────────────────────────────────

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

    it('should throw BadRequestException when no report sections exist', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );
      reportSectionRepo.count.mockResolvedValue(0);

      await expect(
        service.sendRequest('req-1', { method: SendMethod.DOWNLOAD }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed and return download when method is download', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );
      reportSectionRepo.count.mockResolvedValue(3);

      const result = await service.sendRequest(
        'req-1',
        { method: SendMethod.DOWNLOAD },
        'user-1',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(notificationService.notifyPatientIfRequested).toHaveBeenCalled();
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
      reportSectionRepo.count.mockResolvedValue(1);

      const result = await service.sendRequest(
        'req-1',
        { method: SendMethod.EMAIL, to: 'test@test.com' },
        'user-1',
      );

      expect(mailService.sendSurgeryRequestSent).toHaveBeenCalledWith(
        'test@test.com',
        expect.objectContaining({ patientName: 'Paciente Test' }),
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

  // ── startAnalysis (SENT → IN_ANALYSIS) ────────────────────────────────────

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
      expect(notificationService.notifyPatientIfRequested).toHaveBeenCalled();
    });
  });

  // ── acceptAuthorization (IN_ANALYSIS → IN_SCHEDULING) ─────────────────────

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
      expect(notificationService.notifyPatientIfRequested).toHaveBeenCalled();
    });
  });

  // ── contestAuthorization ──────────────────────────────────────────────────

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

      const result = await service.contestAuthorization(
        'req-1',
        {
          reason: 'Negado pelo plano',
          method: SendMethod.EMAIL,
          to: 'plano@test.com',
        },
        'user-1',
      );

      expect(contestationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          surgeryRequestId: 'req-1',
          type: 'authorization',
          reason: 'Negado pelo plano',
        }),
      );
      expect(mailService.sendSurgeryContested).toHaveBeenCalled();
      expect(result).toEqual({ sent: true, method: SendMethod.EMAIL });
    });
  });

  // ── confirmDate (IN_SCHEDULING → SCHEDULED) ──────────────────────────────

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
        dateOptions: ['2026-03-01', '2026-03-10'] as any,
      });
      surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        request,
      );

      await service.confirmDate('req-1', { selectedDateIndex: 0 }, 'user-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(notificationService.notifyPatientIfRequested).toHaveBeenCalled();
    });
  });

  // ── updateDateOptions ─────────────────────────────────────────────────────

  describe('updateDateOptions', () => {
    it('should throw when status is not IN_SCHEDULING', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(
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
      surgeryRequestRepository.findOneSimple.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.IN_SCHEDULING }),
      );

      await service.updateDateOptions(
        'req-1',
        { dateOptions: ['2026-04-01', '2026-04-10'] },
        'user-1',
      );

      expect(surgeryRequestRepository.update).toHaveBeenCalledWith('req-1', {
        dateOptions: ['2026-04-01', '2026-04-10'],
      });
    });
  });

  // ── reschedule ────────────────────────────────────────────────────────────

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

      expect(surgeryRequestRepository.update).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ surgeryDate: expect.any(Date) }),
      );
    });
  });

  // ── markPerformed (SCHEDULED → PERFORMED) ─────────────────────────────────

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

      // markPerformed roda em executeInTransaction (envolve dataSource.transaction)
      // e dispara notificações de admin e stakeholders.
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(
        notificationService.notifyAdminsOfWorkflowAction,
      ).toHaveBeenCalled();
      expect(
        notificationService.notifyStakeholdersOfStatusChange,
      ).toHaveBeenCalled();
    });
  });

  // ── Billing delegations ───────────────────────────────────────────────────

  describe('invoiceRequest', () => {
    it('should delegate to billingService', async () => {
      const dto = {
        invoiceProtocol: 'INV-001',
        invoiceSentAt: '2026-04-01',
        invoiceValue: 5000,
      };

      await service.invoiceRequest('req-1', dto as any, 'user-1');

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

      await service.confirmReceipt('req-1', dto as any, 'user-1');

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

      await service.contestPayment('req-1', dto as any, 'user-1');

      expect(billingService.contestPayment).toHaveBeenCalledWith(
        'req-1',
        dto,
        'user-1',
      );
    });
  });

  // ── closeSurgeryRequest (ANY → CLOSED) ────────────────────────────────────

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
  });

  // ── notify ────────────────────────────────────────────────────────────────

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
});
