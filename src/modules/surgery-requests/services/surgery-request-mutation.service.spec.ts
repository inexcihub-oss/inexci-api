import { NotFoundException } from '@nestjs/common';
import { SurgeryRequestMutationService } from './surgery-request-mutation.service';

/**
 * Cobre só o que este módulo adiciona a `update()`: permitir escolher/trocar
 * o procedimento (`procedureId`) direto na tela da SC — o mesmo campo que já
 * existe na criação (`create`/`createSurgeryRequest`), agora editável depois
 * que a solicitação já existe. O restante de `update()` (hospital, convênio,
 * CID, prioridade) já roda em produção sem suíte própria; não é reescrito
 * aqui.
 */
describe('SurgeryRequestMutationService.update — procedimento', () => {
  let service: SurgeryRequestMutationService;

  const ownerId = 'owner-1';
  const userId = 'user-1';

  const existingRequest = {
    id: 'sc-1',
    ownerId,
    doctorId: 'doctor-1',
    patientId: 'patient-1',
    hospitalId: null,
    healthPlanId: null,
    healthPlanRegistration: null,
    procedureId: null,
  };

  const mockAccess = {
    buildSurgeryAccessWhere: jest.fn(),
    getOwnerId: jest.fn(),
  };
  const mockDoctorResolution = { resolveDoctorId: jest.fn() };
  const mockWhatsapp = {};
  const mockUserRepo = { findOne: jest.fn() };
  const mockPatientRepo = { findOne: jest.fn(), update: jest.fn() };
  const mockHospitalRepo = { findOne: jest.fn(), save: jest.fn() };
  const mockHealthPlanRepo = { findOne: jest.fn(), save: jest.fn() };
  const mockProcedureRepo = { findOne: jest.fn() };
  const mockSurgeryRequestRepo = {
    findOneSimple: jest.fn(),
    update: jest.fn(),
  };
  const mockRealtime = { broadcastChange: jest.fn() };
  const mockDataSource = {};

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccess.buildSurgeryAccessWhere.mockResolvedValue({ id: 'sc-1' });
    mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
      ...existingRequest,
    });
    mockSurgeryRequestRepo.update.mockResolvedValue(undefined);
    mockRealtime.broadcastChange.mockResolvedValue(undefined);
    mockProcedureRepo.findOne.mockResolvedValue({ id: 'proc-1', ownerId });

    service = new SurgeryRequestMutationService(
      mockDataSource as never,
      mockAccess as never,
      mockDoctorResolution as never,
      mockWhatsapp as never,
      mockUserRepo as never,
      mockPatientRepo as never,
      mockHospitalRepo as never,
      mockHealthPlanRepo as never,
      mockProcedureRepo as never,
      mockSurgeryRequestRepo as never,
      mockRealtime as never,
    );
  });

  it('atualiza o procedimento quando ele pertence à mesma clínica', async () => {
    await service.update({ id: 'sc-1', procedureId: 'proc-1' }, userId);

    expect(mockProcedureRepo.findOne).toHaveBeenCalledWith({ id: 'proc-1' });
    expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith(
      'sc-1',
      expect.objectContaining({ procedureId: 'proc-1' }),
    );
  });

  it('rejeita procedimento de outra clínica', async () => {
    mockProcedureRepo.findOne.mockResolvedValue({
      id: 'proc-1',
      ownerId: 'outra-clinica',
    });

    await expect(
      service.update({ id: 'sc-1', procedureId: 'proc-1' }, userId),
    ).rejects.toThrow(NotFoundException);
    expect(mockSurgeryRequestRepo.update).not.toHaveBeenCalled();
  });

  it('permite limpar o procedimento (null) sem validar posse', async () => {
    await service.update({ id: 'sc-1', procedureId: null }, userId);

    expect(mockProcedureRepo.findOne).not.toHaveBeenCalled();
    expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith(
      'sc-1',
      expect.objectContaining({ procedureId: null }),
    );
  });

  it('não mexe no procedimento quando o campo não é enviado', async () => {
    await service.update({ id: 'sc-1', priority: 2 }, userId);

    expect(mockProcedureRepo.findOne).not.toHaveBeenCalled();
    const [, updatePayload] = mockSurgeryRequestRepo.update.mock.calls[0];
    expect(updatePayload).not.toHaveProperty('procedureId');
  });
});
