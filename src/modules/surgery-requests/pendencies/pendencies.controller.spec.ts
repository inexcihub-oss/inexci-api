import { PendenciesController } from './pendencies.controller';
import { PENDENCIES_CONFIG } from 'src/config/pendencies.config';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

describe('PendenciesController.getRequirements', () => {
  const controller = new PendenciesController({} as never);

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

  /**
   * O teste acima compara com uma lista literal: ele passaria igual se o
   * controller devolvesse um array escrito à mão. Este aqui é o que sustenta a
   * razão de existir da rota — mexer no config tem que mexer na resposta, sem
   * ninguém tocar no controller. Falha contra qualquer cópia hardcoded.
   */
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
