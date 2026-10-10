import { PendenciesController } from './pendencies.controller';
import { PENDENCIES_CONFIG } from 'src/config/pendencies.config';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

describe('PendenciesController.getRequirements', () => {
  const controller = new PendenciesController({} as never, {} as never);

  it('devolve a configuração estática de todos os status', () => {
    const requisitos = controller.getRequirements();

    expect(Array.isArray(requisitos)).toBe(true);
    expect(requisitos.length).toBeGreaterThan(0);
  });

  it('expõe os cinco requisitos bloqueantes de Pendente', () => {
    const pendente = controller.getRequirements().find((r) => r.status === 1);

    expect(pendente).toBeDefined();
    expect(pendente!.pendencies.map((p) => p.key)).toEqual([
      'patient_data',
      'hospital_data',
      'tuss_procedures',
      'opme_items',
      'medical_report',
    ]);
    expect(pendente!.pendencies.every((p) => p.blocking)).toBe(true);
  });

  it('deriva do pendencies.config, não de uma cópia', () => {
    const doConfig = PENDENCIES_CONFIG.find(
      (c) => c.status === SurgeryRequestStatus.PENDING,
    )!;
    const original = doConfig.pendencies;

    try {
      doConfig.pendencies = [
        ...original,
        {
          key: 'requisito_de_teste',
          label: 'Requisito de teste',
          blocking: true,
          responsibleRole: 'collaborator',
        },
      ];

      const pendente = controller
        .getRequirements()
        .find((r) => r.status === SurgeryRequestStatus.PENDING)!;

      expect(pendente.pendencies.map((p) => p.key)).toContain(
        'requisito_de_teste',
      );
      expect(pendente.pendencies).toHaveLength(original.length + 1);
    } finally {
      doConfig.pendencies = original;
    }
  });

  it('devolve os status sem pendência com a lista vazia', () => {
    const enviada = controller
      .getRequirements()
      .find((r) => r.status === SurgeryRequestStatus.SENT);

    expect(enviada).toBeDefined();
    expect(enviada!.pendencies).toEqual([]);
  });
});

describe('PendenciesController.getBatchSummary', () => {
  it('recorta o lote pelos médicos que o usuário enxerga', async () => {
    const validator = {
      getBatchSummary: jest.fn().mockResolvedValue({}),
    };
    const accessControl = {
      getAccessibleDoctorIds: jest.fn().mockResolvedValue(['doc-1']),
    };
    const controller = new PendenciesController(
      validator as never,
      accessControl as never,
    );

    await controller.getBatchSummary('sc-1,sc-2', {
      userId: 'user-1',
      ownerId: 'owner-1',
    } as never);

    expect(accessControl.getAccessibleDoctorIds).toHaveBeenCalledWith('user-1');
    expect(validator.getBatchSummary).toHaveBeenCalledWith('sc-1,sc-2', [
      'doc-1',
    ]);
  });
});
