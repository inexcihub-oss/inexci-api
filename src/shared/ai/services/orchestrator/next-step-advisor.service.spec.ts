import { NextStepAdvisorService } from './next-step-advisor.service';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { PendencyValidatorService } from '../../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { ToolContext } from '../../tools/tool.interface';

const makeContext = (doctorIds: string[] = ['doctor-1']): ToolContext =>
  ({
    accessibleDoctorIds: doctorIds,
    userId: 'user-1',
    conversationId: 'conv-1',
  }) as unknown as ToolContext;

describe('NextStepAdvisorService', () => {
  let service: NextStepAdvisorService;
  let surgeryRequestRepo: jest.Mocked<
    Pick<SurgeryRequestRepository, 'findOneSimple'>
  >;
  let pendencyValidator: jest.Mocked<
    Pick<PendencyValidatorService, 'validateForStatus'>
  >;

  beforeEach(() => {
    surgeryRequestRepo = {
      findOneSimple: jest.fn(),
    };
    pendencyValidator = {
      validateForStatus: jest.fn(),
    };
    service = new NextStepAdvisorService(
      surgeryRequestRepo as unknown as SurgeryRequestRepository,
      pendencyValidator as unknown as PendencyValidatorService,
    );
  });

  describe('appendNextStep', () => {
    it('retorna output original quando toolName não é mutação', async () => {
      const output = 'Lista de pacientes...';
      const result = await service.appendNextStep(
        'list_patients',
        { confirm: true },
        output,
        makeContext(),
      );
      expect(result).toBe(output);
      expect(surgeryRequestRepo.findOneSimple).not.toHaveBeenCalled();
    });

    it('retorna output original quando confirm !== true', async () => {
      const output = 'Hospital vinculado com sucesso.';
      const result = await service.appendNextStep(
        'set_hospital',
        { surgeryRequestId: 'req-1' },
        output,
        makeContext(),
      );
      expect(result).toBe(output);
      expect(surgeryRequestRepo.findOneSimple).not.toHaveBeenCalled();
    });

    it('retorna output original quando resultado indica falha (erro)', async () => {
      const output = 'Erro: hospital não encontrado.';
      const result = await service.appendNextStep(
        'set_hospital',
        { confirm: true, surgeryRequestId: 'req-1' },
        output,
        makeContext(),
      );
      expect(result).toBe(output);
      expect(surgeryRequestRepo.findOneSimple).not.toHaveBeenCalled();
    });

    it('appenda hint "sem pendências" quando SC está limpa', async () => {
      surgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        doctorId: 'doctor-1',
      } as any);
      pendencyValidator.validateForStatus.mockResolvedValue({
        pendencies: [
          {
            isComplete: true,
            isOptional: false,
            key: 'patient_data',
            name: 'Dados do paciente',
          },
        ],
      } as any);

      const result = await service.appendNextStep(
        'set_hospital',
        { confirm: true, surgeryRequestId: 'req-1' },
        'Hospital vinculado com sucesso.',
        makeContext(),
      );

      expect(result).toContain('sem pendências bloqueantes');
      expect(result).toContain('advance_surgery_request');
    });

    it('appenda hint de próximo passo quando há pendência bloqueante', async () => {
      surgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        doctorId: 'doctor-1',
      } as any);
      pendencyValidator.validateForStatus.mockResolvedValue({
        pendencies: [
          {
            isComplete: false,
            isOptional: false,
            key: 'medical_report',
            name: 'Laudo médico',
          },
        ],
      } as any);

      const result = await service.appendNextStep(
        'set_hospital',
        { confirm: true, surgeryRequestId: 'req-1' },
        'Hospital vinculado com sucesso.',
        makeContext(),
      );

      expect(result).toContain('Pendência atual: Laudo médico');
      expect(result).toContain('manage_report_sections');
    });

    it('retorna output original quando requestId está ausente nos args', async () => {
      const output = 'Atualizado com sucesso.';
      const result = await service.appendNextStep(
        'set_hospital',
        { confirm: true },
        output,
        makeContext(),
      );
      expect(result).toBe(output);
      expect(surgeryRequestRepo.findOneSimple).not.toHaveBeenCalled();
    });

    it('retorna output original quando doctorId não está acessível', async () => {
      surgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        doctorId: 'doctor-other',
      } as any);

      const result = await service.appendNextStep(
        'set_hospital',
        { confirm: true, surgeryRequestId: 'req-1' },
        'Hospital vinculado com sucesso.',
        makeContext(['doctor-1']),
      );

      expect(result).toBe('Hospital vinculado com sucesso.');
      expect(pendencyValidator.validateForStatus).not.toHaveBeenCalled();
    });
  });
});
