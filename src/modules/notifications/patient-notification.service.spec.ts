import { Test, TestingModule } from '@nestjs/testing';
import { PatientNotificationService } from './patient-notification.service';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

jest.mock('src/shared/whatsapp/whatsapp-templates.constants', () => ({
  WHATSAPP_TEMPLATES: {
    STATUS_CHANGE_PATIENT: 'mock-status-sid',
    STALE_REMINDER: 'mock-stale-reminder-sid',
    STALE_CRITICAL: 'mock-stale-critical-sid',
    WELCOME_PATIENT: 'mock-welcome-patient-sid',
    WELCOME_DOCTOR: 'mock-welcome-doctor-sid',
  },
}));

describe('PatientNotificationService', () => {
  let service: PatientNotificationService;
  const mockMailService = {
    sendStatusUpdate: jest.fn().mockResolvedValue(undefined),
  };
  const mockWhatsappService = {
    sendTemplate: jest.fn().mockResolvedValue(undefined),
  };

  const baseRequest = {
    id: 'req-1',
    protocol: 'PROT-001',
    patient: {
      name: 'João Silva',
      email: 'joao@test.com',
      phone: '+5511999999999',
    },
    hospital: { name: 'Hospital ABC' },
    created_by: { name: 'Dr. Maria' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientNotificationService,
        { provide: MailService, useValue: mockMailService },
        { provide: WhatsappService, useValue: mockWhatsappService },
      ],
    }).compile();

    service = module.get<PatientNotificationService>(
      PatientNotificationService,
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  it('notifyPatient=true → paciente recebe e-mail + WhatsApp (6.4.1)', async () => {
    await service.notifyPatientStatusChange({
      request: baseRequest,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: true,
    });

    expect(mockMailService.sendStatusUpdate).toHaveBeenCalledWith(
      'joao@test.com',
      expect.objectContaining({ patientName: 'João Silva' }),
    );
    expect(mockWhatsappService.sendTemplate).toHaveBeenCalledWith(
      '+5511999999999',
      'mock-status-sid',
      expect.objectContaining({ '1': 'João Silva' }),
    );
  });

  it('notifyPatient=false → paciente NÃO recebe nada (6.4.1)', async () => {
    await service.notifyPatientStatusChange({
      request: baseRequest,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: false,
    });

    expect(mockMailService.sendStatusUpdate).not.toHaveBeenCalled();
    expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
  });

  it('paciente sem e-mail → apenas WhatsApp (se tem telefone) (6.4.1)', async () => {
    const request = {
      ...baseRequest,
      patient: { ...baseRequest.patient, email: undefined },
    };

    await service.notifyPatientStatusChange({
      request,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: true,
    });

    expect(mockMailService.sendStatusUpdate).not.toHaveBeenCalled();
    expect(mockWhatsappService.sendTemplate).toHaveBeenCalled();
  });

  it('paciente sem telefone → apenas e-mail (se tem e-mail) (6.4.1)', async () => {
    const request = {
      ...baseRequest,
      patient: { ...baseRequest.patient, phone: undefined },
    };

    await service.notifyPatientStatusChange({
      request,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: true,
    });

    expect(mockMailService.sendStatusUpdate).toHaveBeenCalled();
    expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
  });

  it('paciente sem e-mail e sem telefone → nenhum envio, sem erro (6.4.1)', async () => {
    const request = {
      ...baseRequest,
      patient: { name: 'João Silva', email: undefined, phone: undefined },
    };

    await expect(
      service.notifyPatientStatusChange({
        request,
        oldStatus: SurgeryRequestStatus.SENT,
        newStatus: SurgeryRequestStatus.IN_ANALYSIS,
        notifyPatient: true,
      }),
    ).resolves.toBeUndefined();

    expect(mockMailService.sendStatusUpdate).not.toHaveBeenCalled();
    expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
  });

  it('WhatsApp usa sendTemplate com contentSid (não freeform) (6.4.1)', async () => {
    await service.notifyPatientStatusChange({
      request: baseRequest,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: true,
    });

    expect(mockWhatsappService.sendTemplate).toHaveBeenCalledWith(
      expect.any(String),
      'mock-status-sid', // contentSid
      expect.any(Object),
    );
  });

  it('falha no e-mail não impede envio de WhatsApp (6.4.1)', async () => {
    mockMailService.sendStatusUpdate.mockRejectedValueOnce(
      new Error('SMTP down'),
    );

    await service.notifyPatientStatusChange({
      request: baseRequest,
      oldStatus: SurgeryRequestStatus.SENT,
      newStatus: SurgeryRequestStatus.IN_ANALYSIS,
      notifyPatient: true,
    });

    expect(mockWhatsappService.sendTemplate).toHaveBeenCalled();
  });
});
