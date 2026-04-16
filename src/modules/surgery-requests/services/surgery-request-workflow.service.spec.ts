import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { SurgeryRequestWorkflowService } from './surgery-request-workflow.service';
import { SurgeryRequestBillingService } from './surgery-request-billing.service';
import { SurgeryRequestNotificationService } from './surgery-request-notification.service';
import { SurgeryRequestPdfAssemblyService } from './surgery-request-pdf-assembly.service';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { PdfGenerationService } from 'src/shared/pdf/pdf-generation.service';

import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestAnalysis } from 'src/database/entities/surgery-request-analysis.entity';
import { Contestation } from 'src/database/entities/contestation.entity';
import { ReportSection } from 'src/database/entities/report-section.entity';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<SurgeryRequest> = {}): SurgeryRequest {
  return {
    id: 'req-1',
    status: SurgeryRequestStatus.PENDING,
    patient_id: 'patient-1',
    hospital_id: 'hospital-1',
    health_plan_id: 'hp-1',
    created_by: { id: 'user-1', name: 'Dr. Test' },
    patient: { id: 'patient-1', name: 'Paciente Test' },
    hospital: { id: 'hospital-1', name: 'Hospital Test' },
    health_plan: { id: 'hp-1', name: 'Plano Test' },
    tuss_items: [{ id: 't1', tuss_code: '123', name: 'Proc', quantity: 1 }],
    opme_items: [],
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
  let surgeryRequestRepository: jest.Mocked<Partial<SurgeryRequestRepository>>;
  let mailService: jest.Mocked<Partial<MailService>>;
  let pdfGenerationService: jest.Mocked<Partial<PdfGenerationService>>;
  let notificationService: jest.Mocked<
    Partial<SurgeryRequestNotificationService>
  >;
  let pdfAssemblyService: jest.Mocked<
    Partial<SurgeryRequestPdfAssemblyService>
  >;
  let billingService: jest.Mocked<Partial<SurgeryRequestBillingService>>;
  let reportSectionRepo: jest.Mocked<Partial<Repository<ReportSection>>>;
  let contestationRepo: jest.Mocked<Partial<Repository<Contestation>>>;
  let analysisRepo: jest.Mocked<Partial<Repository<SurgeryRequestAnalysis>>>;
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    surgeryRequestRepository = {
      findOneWithRelations: jest.fn(),
      findOneSimple: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
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

    contestationRepo = {
      save: jest.fn().mockResolvedValue({}),
    };

    analysisRepo = {
      save: jest.fn().mockResolvedValue({}),
    };

    // Mock DataSource.transaction to execute the callback with a mock manager
    dataSource = {
      transaction: jest.fn(async (cb: (manager: any) => Promise<any>) => {
        const mockManager = createMockManager();
        return cb(mockManager);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurgeryRequestWorkflowService,
        { provide: DataSource, useValue: dataSource },
        { provide: MailService, useValue: mailService },
        { provide: PdfGenerationService, useValue: pdfGenerationService },
        {
          provide: SurgeryRequestRepository,
          useValue: surgeryRequestRepository,
        },
        {
          provide: getRepositoryToken(SurgeryRequestAnalysis),
          useValue: analysisRepo,
        },
        {
          provide: getRepositoryToken(Contestation),
          useValue: contestationRepo,
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
      ],
    }).compile();

    service = module.get(SurgeryRequestWorkflowService);
  });

  // ── sendRequest (PENDING → SENT) ──────────────────────────────────────────

  describe('sendRequest', () => {
    it('should throw NotFoundException when request not found', async () => {
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(null);

      await expect(
        service.sendRequest('non-existent', { method: 'download' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when no report sections exist', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);
      reportSectionRepo.count.mockResolvedValue(0);

      await expect(
        service.sendRequest('req-1', { method: 'download' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed and return download when method is download', async () => {
      const request = makeRequest();
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);
      reportSectionRepo.count.mockResolvedValue(3);

      const result = await service.sendRequest(
        'req-1',
        { method: 'download' },
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
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);
      reportSectionRepo.count.mockResolvedValue(1);

      const result = await service.sendRequest(
        'req-1',
        { method: 'email', to: 'test@test.com' },
        'user-1',
      );

      expect(mailService.sendSurgeryRequestSent).toHaveBeenCalledWith(
        'test@test.com',
        expect.objectContaining({ patientName: 'Paciente Test' }),
      );
      expect(result).toEqual({ sent: true, method: 'email' });
    });

    it('should throw when status is not PENDING', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await expect(
        service.sendRequest('req-1', { method: 'download' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── startAnalysis (SENT → IN_ANALYSIS) ────────────────────────────────────

  describe('startAnalysis', () => {
    it('should throw when status is not SENT', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.PENDING });
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await expect(
        service.startAnalysis(
          'req-1',
          { request_number: '123', received_at: new Date().toISOString() },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when status is SENT', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.SENT });
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await service.startAnalysis(
        'req-1',
        { request_number: 'REQ-001', received_at: '2026-01-15T00:00:00Z' },
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
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await expect(
        service.acceptAuthorization(
          'req-1',
          { date_options: ['2026-03-01'] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when status is IN_ANALYSIS', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await service.acceptAuthorization(
        'req-1',
        { date_options: ['2026-03-01', '2026-03-05'] },
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
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await expect(
        service.contestAuthorization(
          'req-1',
          { reason: 'Negado', method: 'email', to: 'a@b.com' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should save contestation and send email when method is email', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      const result = await service.contestAuthorization(
        'req-1',
        { reason: 'Negado pelo plano', method: 'email', to: 'plano@test.com' },
        'user-1',
      );

      expect(contestationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          surgery_request_id: 'req-1',
          type: 'authorization',
          reason: 'Negado pelo plano',
        }),
      );
      expect(mailService.sendSurgeryContested).toHaveBeenCalled();
      expect(result).toEqual({ sent: true, method: 'email' });
    });
  });

  // ── confirmDate (IN_SCHEDULING → SCHEDULED) ──────────────────────────────

  describe('confirmDate', () => {
    it('should throw when status is not IN_SCHEDULING', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await expect(
        service.confirmDate('req-1', { selected_date_index: 0 }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when date index is invalid', async () => {
      const request = makeRequest({
        status: SurgeryRequestStatus.IN_SCHEDULING,
        date_options: ['2026-03-01'],
      });
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await expect(
        service.confirmDate(
          'req-1',
          { selected_date_index: 2 as any },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed with valid date index', async () => {
      const request = makeRequest({
        status: SurgeryRequestStatus.IN_SCHEDULING,
        date_options: ['2026-03-01', '2026-03-10'] as any,
      });
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await service.confirmDate('req-1', { selected_date_index: 0 }, 'user-1');

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
          { date_options: ['2026-04-01'] },
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
        { date_options: ['2026-04-01', '2026-04-10'] },
        'user-1',
      );

      expect(surgeryRequestRepository.update).toHaveBeenCalledWith('req-1', {
        date_options: ['2026-04-01', '2026-04-10'],
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
        service.reschedule('req-1', { new_date: '2026-05-01' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update surgery date when scheduled', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(
        makeRequest({ status: SurgeryRequestStatus.SCHEDULED }),
      );

      await service.reschedule('req-1', { new_date: '2026-05-01' }, 'user-1');

      expect(surgeryRequestRepository.update).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ surgery_date: expect.any(Date) }),
      );
    });
  });

  // ── markPerformed (SCHEDULED → PERFORMED) ─────────────────────────────────

  describe('markPerformed', () => {
    it('should throw when status is not SCHEDULED', async () => {
      const request = makeRequest({
        status: SurgeryRequestStatus.IN_SCHEDULING,
      });
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await expect(
        service.markPerformed(
          'req-1',
          { surgery_performed_at: '2026-03-15T10:00:00Z' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when status is SCHEDULED', async () => {
      const request = makeRequest({ status: SurgeryRequestStatus.SCHEDULED });
      surgeryRequestRepository.findOneWithRelations.mockResolvedValue(request);

      await service.markPerformed(
        'req-1',
        { surgery_performed_at: '2026-03-15T10:00:00Z' },
        'user-1',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(notificationService.notifyPatientIfRequested).toHaveBeenCalled();
    });
  });

  // ── Billing delegations ───────────────────────────────────────────────────

  describe('invoiceRequest', () => {
    it('should delegate to billingService', async () => {
      const dto = {
        invoice_protocol: 'INV-001',
        invoice_sent_at: '2026-04-01',
        invoice_value: 5000,
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
        received_value: 5000,
        received_at: '2026-04-15',
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
