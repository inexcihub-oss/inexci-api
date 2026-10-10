import { NotFoundException } from '@nestjs/common';
import { SurgeryRequestMutationService } from './surgery-request-mutation.service';
import { SurgeryRequestPriority } from 'src/database/entities/surgery-request.entity';

const ownerId = 'owner-1';
const userId = 'user-1';

type Registry = Record<string, Record<string, string>>;

function buildManager(registry: Registry) {
  const saved: Record<string, unknown[]> = {};
  const getRepository = jest.fn((entity: { name: string }) => ({
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      const owner = registry[entity.name]?.[where.id];
      return owner ? { id: where.id, ownerId: owner } : null;
    }),
    save: jest.fn(async (data: Record<string, unknown>) => {
      (saved[entity.name] ??= []).push(data);
      return { id: `${entity.name}-new`, ...data };
    }),
  }));
  return { getRepository, saved };
}

describe('SurgeryRequestMutationService', () => {
  let service: SurgeryRequestMutationService;
  let registry: Registry;
  let manager: ReturnType<typeof buildManager>;

  const existingRequest = {
    id: 'sc-1',
    ownerId,
    doctorId: 'doctor-1',
    patientId: 'patient-1',
    status: 1,
    hospitalId: null,
    healthPlanId: null,
    healthPlanRegistration: null,
    procedureId: null,
  };

  const mockAccess = {
    buildSurgeryAccessWhere: jest.fn(),
    getOwnerId: jest.fn(),
    getAccessibleDoctorIds: jest.fn(),
  };
  const mockDoctorResolution = { resolveDoctorId: jest.fn() };
  const mockUserRepo = { findOne: jest.fn() };
  const mockPatientRepo = { findOne: jest.fn(), update: jest.fn() };
  const mockHospitalRepo = { findOne: jest.fn(), create: jest.fn() };
  const mockHealthPlanRepo = { findOne: jest.fn(), create: jest.fn() };
  const mockSurgeryRequestRepo = {
    findOneSimple: jest.fn(),
    update: jest.fn(),
  };
  const mockRealtime = { broadcastChange: jest.fn() };
  const mockTussItemRepo = { create: jest.fn() };
  let mockDataSource: { manager: unknown; transaction: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    registry = {
      Patient: { 'patient-1': ownerId, 'patient-x': 'outra-clinica' },
      Hospital: { 'hosp-1': ownerId, 'hosp-x': 'outra-clinica' },
      HealthPlan: { 'hp-1': ownerId, 'hp-x': 'outra-clinica' },
      Procedure: { 'proc-1': ownerId, 'proc-x': 'outra-clinica' },
    };
    manager = buildManager(registry);
    mockDataSource = {
      manager,
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
    };

    mockAccess.buildSurgeryAccessWhere.mockResolvedValue({ id: 'sc-1' });
    mockAccess.getOwnerId.mockResolvedValue(ownerId);
    mockDoctorResolution.resolveDoctorId.mockResolvedValue('doctor-1');
    mockUserRepo.findOne.mockResolvedValue({ id: userId });
    mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
      ...existingRequest,
    });
    mockSurgeryRequestRepo.update.mockResolvedValue(undefined);
    mockRealtime.broadcastChange.mockResolvedValue(undefined);

    service = new SurgeryRequestMutationService(
      mockDataSource as never,
      mockAccess as never,
      mockDoctorResolution as never,
      mockUserRepo as never,
      mockPatientRepo as never,
      mockHospitalRepo as never,
      mockHealthPlanRepo as never,
      mockSurgeryRequestRepo as never,
      mockRealtime as never,
      mockTussItemRepo as never,
    );
  });

  describe('update — procedimento', () => {
    it('atualiza o procedimento quando ele pertence à mesma clínica', async () => {
      await service.update({ id: 'sc-1', procedureId: 'proc-1' }, userId);

      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({ procedureId: 'proc-1' }),
      );
    });

    it('rejeita procedimento de outra clínica', async () => {
      await expect(
        service.update({ id: 'sc-1', procedureId: 'proc-x' }, userId),
      ).rejects.toThrow(NotFoundException);
      expect(mockSurgeryRequestRepo.update).not.toHaveBeenCalled();
    });

    it('permite limpar o procedimento (null) sem validar posse', async () => {
      await service.update({ id: 'sc-1', procedureId: null }, userId);

      expect(manager.getRepository).not.toHaveBeenCalled();
      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({ procedureId: null }),
      );
    });

    it('não mexe no procedimento quando o campo não é enviado', async () => {
      await service.update({ id: 'sc-1', priority: 2 }, userId);

      const [, updatePayload] = mockSurgeryRequestRepo.update.mock.calls[0];
      expect(updatePayload).not.toHaveProperty('procedureId');
    });
  });

  describe('createSurgeryRequest — isolamento de tenant (B1)', () => {
    const base = {
      patientId: 'patient-1',
      priority: SurgeryRequestPriority.MEDIUM,
    };

    it('cria a SC quando todos os cadastros são da clínica', async () => {
      await service.createSurgeryRequest(
        {
          ...base,
          hospitalId: 'hosp-1',
          healthPlanId: 'hp-1',
          procedureId: 'proc-1',
        },
        userId,
      );

      expect(manager.saved.SurgeryRequest).toHaveLength(1);
      expect(mockRealtime.broadcastChange).toHaveBeenCalledWith(
        'SurgeryRequest-new',
        'created',
        userId,
      );
    });

    it.each([
      ['patientId', { patientId: 'patient-x' }, 'Paciente não encontrado'],
      ['hospitalId', { hospitalId: 'hosp-x' }, 'Hospital não encontrado'],
      ['healthPlanId', { healthPlanId: 'hp-x' }, 'Convênio não encontrado'],
      ['procedureId', { procedureId: 'proc-x' }, 'Procedimento não encontrado'],
      ['patientId inexistente', { patientId: 'nao-existe' }, 'Paciente'],
    ])(
      'recusa %s de outra clínica sem gravar nada',
      async (_label, override, message) => {
        await expect(
          service.createSurgeryRequest({ ...base, ...override }, userId),
        ).rejects.toThrow(message);
        expect(manager.saved.SurgeryRequest).toBeUndefined();
        expect(mockRealtime.broadcastChange).not.toHaveBeenCalled();
      },
    );

    it('com manager do chamador, roda na transação dele e não faz broadcast', async () => {
      const outer = buildManager(registry);
      await service.createSurgeryRequest(base, userId, {
        manager: outer as never,
      });

      expect(mockDataSource.transaction).not.toHaveBeenCalled();
      expect(outer.saved.SurgeryRequest).toHaveLength(1);
      expect(mockRealtime.broadcastChange).not.toHaveBeenCalled();
    });
  });

  describe('updateBasic — isolamento de tenant (B1)', () => {
    it('recusa hospital de outra clínica', async () => {
      await expect(
        service.updateBasic({ id: 'sc-1', hospitalId: 'hosp-x' }, userId),
      ).rejects.toThrow('Hospital não encontrado');
      expect(mockSurgeryRequestRepo.update).not.toHaveBeenCalled();
    });

    it('recusa convênio de outra clínica', async () => {
      await expect(
        service.updateBasic({ id: 'sc-1', healthPlanId: 'hp-x' }, userId),
      ).rejects.toThrow('Convênio não encontrado');
      expect(mockSurgeryRequestRepo.update).not.toHaveBeenCalled();
    });

    it('aceita cadastros da clínica e permite limpar (null)', async () => {
      await service.updateBasic(
        { id: 'sc-1', hospitalId: 'hosp-1', healthPlanId: null },
        userId,
      );

      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith('sc-1', {
        hospitalId: 'hosp-1',
        healthPlanId: null,
      });
    });
  });
});
