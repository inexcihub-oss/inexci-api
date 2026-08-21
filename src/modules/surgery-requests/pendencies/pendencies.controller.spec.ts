import { PendenciesController } from './pendencies.controller';

describe('PendenciesController.getRequirements', () => {
  const controller = new PendenciesController({} as never);

  it('devolve a configuração estática de todos os status', () => {
    const requisitos = controller.getRequirements();

    expect(Array.isArray(requisitos)).toBe(true);
    expect(requisitos.length).toBeGreaterThan(0);
  });

  it('expõe os cinco requisitos bloqueantes de Pendente', () => {
    const pendente = controller
      .getRequirements()
      .find((r) => r.status === 1);

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
});
