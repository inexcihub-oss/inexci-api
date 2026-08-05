import {
  SurgeryRequestPriority,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';
import { SurgeryRequestFromIndicationService } from './surgery-request-from-indication.service';

describe('SurgeryRequestFromIndicationService', () => {
  let service: SurgeryRequestFromIndicationService;
  const scRepo = { save: jest.fn() };
  const activityRepo = { save: jest.fn() };
  const manager = {
    getRepository: jest.fn((entity: { name: string }) =>
      entity.name === 'SurgeryRequest' ? scRepo : activityRepo,
    ),
  };

  const base = {
    ownerId: 'owner-1',
    doctorId: 'doctor-1',
    createdById: 'doctor-1',
    patientId: 'patient-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    scRepo.save.mockImplementation((d) =>
      Promise.resolve({ id: 'sc-1', ...d }),
    );
    activityRepo.save.mockResolvedValue({ id: 'act-1' });
    service = new SurgeryRequestFromIndicationService();
  });

  it('cria a SC em Pendente com prioridade média', async () => {
    const sc = await service.createPendingFromIndication({
      manager: manager as never,
      ...base,
      cidCode: 'M17.1',
    });

    expect(sc.id).toBe('sc-1');
    expect(scRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-1',
        doctorId: 'doctor-1',
        createdById: 'doctor-1',
        patientId: 'patient-1',
        status: SurgeryRequestStatus.PENDING,
        priority: SurgeryRequestPriority.MEDIUM,
        isIndication: false,
        cidCode: 'M17.1',
        lastStatusChangedAt: expect.any(Date),
      }),
    );
  });

  it('registra a atividade de sistema junto da SC', async () => {
    await service.createPendingFromIndication({
      manager: manager as never,
      ...base,
    });

    expect(activityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        surgeryRequestId: 'sc-1',
        type: ActivityType.SYSTEM,
        content: 'Solicitação cirúrgica criada a partir do atendimento',
      }),
    );
  });

  // cid_code é varchar(10): um CID mais longo estouraria o insert e derrubaria a
  // criação inteira em silêncio (mesma armadilha do documents.name varchar(75)).
  it('trunca o CID em 10 caracteres', async () => {
    await service.createPendingFromIndication({
      manager: manager as never,
      ...base,
      cidCode: 'M17.1234567890',
    });

    expect(scRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ cidCode: 'M17.123456' }),
    );
  });

  it('aceita ficha sem CID', async () => {
    await service.createPendingFromIndication({
      manager: manager as never,
      ...base,
      cidCode: null,
    });

    expect(scRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ cidCode: null }),
    );
  });
});
