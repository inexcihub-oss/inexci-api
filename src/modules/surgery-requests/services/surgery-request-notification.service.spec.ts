import { Test, TestingModule } from '@nestjs/testing';
import { SurgeryRequestNotificationService } from './surgery-request-notification.service';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { PatientNotificationService } from 'src/modules/notifications/patient-notification.service';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

jest.mock('src/shared/whatsapp/whatsapp-templates.constants', () => ({
  WHATSAPP_TEMPLATES: {
    STATUS_CHANGE_PATIENT: 'HXtest123',
  },
}));

describe('SurgeryRequestNotificationService', () => {
  let service: SurgeryRequestNotificationService;
  let mockMailService: { sendStatusChangePatient: jest.Mock };
  let mockWhatsappService: { sendTemplate: jest.Mock };
  let mockNotificationsService: { notifyAdminsOfAction: jest.Mock };
  let mockRepository: { findOneWithRelations: jest.Mock };
  let mockPatientNotificationService: { notifyPatientStatusChange: jest.Mock };

  const baseRequest = {
    id: 'req-1',
    protocol: 'PROT-001',
    patient: {
      name: 'João Silva',
      email: 'joao@email.com',
      phone: '+5511999999999',
    },
  };

  beforeEach(async () => {
    mockMailService = {
      sendStatusChangePatient: jest.fn().mockResolvedValue(undefined),
    };
    mockWhatsappService = {
      sendTemplate: jest.fn().mockResolvedValue(undefined),
    };
    mockNotificationsService = {
      notifyAdminsOfAction: jest.fn().mockResolvedValue(undefined),
    };
    mockRepository = { findOneWithRelations: jest.fn() };
    mockPatientNotificationService = {
      notifyPatientStatusChange: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurgeryRequestNotificationService,
        { provide: SurgeryRequestRepository, useValue: mockRepository },
        { provide: MailService, useValue: mockMailService },
        { provide: WhatsappService, useValue: mockWhatsappService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        {
          provide: PatientNotificationService,
          useValue: mockPatientNotificationService,
        },
      ],
    }).compile();

    service = module.get<SurgeryRequestNotificationService>(
      SurgeryRequestNotificationService,
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('notifyPatientIfRequested', () => {
    const prev = SurgeryRequestStatus.SENT;
    const next = SurgeryRequestStatus.IN_ANALYSIS;

    it('delega para PatientNotificationService com notifyPatient=false', async () => {
      await service.notifyPatientIfRequested(baseRequest, prev, next, false);
      expect(
        mockPatientNotificationService.notifyPatientStatusChange,
      ).not.toHaveBeenCalled();
    });

    it('não notifica quando notifyPatient está ausente', async () => {
      await service.notifyPatientIfRequested(baseRequest, prev, next);
      expect(
        mockPatientNotificationService.notifyPatientStatusChange,
      ).not.toHaveBeenCalled();
    });

    it('delega para PatientNotificationService com notifyPatient=true', async () => {
      await service.notifyPatientIfRequested(baseRequest, prev, next, true);
      expect(
        mockPatientNotificationService.notifyPatientStatusChange,
      ).toHaveBeenCalledWith({
        request: baseRequest,
        oldStatus: prev,
        newStatus: next,
        notifyPatient: true,
      });
    });

    it('passa o request completo para o PatientNotificationService', async () => {
      const request = { ...baseRequest, hospital: { name: 'Hospital ABC' } };
      await service.notifyPatientIfRequested(request, prev, next, true);

      const ctx =
        mockPatientNotificationService.notifyPatientStatusChange.mock
          .calls[0][0];
      expect(ctx.request).toBe(request);
      expect(ctx.oldStatus).toBe(prev);
      expect(ctx.newStatus).toBe(next);
    });
  });
});
