import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { AppointmentsController } from './appointments.controller';

describe('AppointmentsController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof AppointmentsController) =>
    reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      AppointmentsController.prototype[metodo],
    );

  it('exige agenda no controller inteiro por padrão', () => {
    expect(reflector.get(PERMISSIONS_KEY, AppointmentsController)).toEqual([
      Permission.AGENDA,
    ]);
  });

  /** O hub /atendimento lista as consultas do médico sem ele ter Agenda. */
  it.each(['findAgenda', 'findByPatient', 'findOne'] as const)(
    'aceita agenda ou atendimento na leitura: %s',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual([
        Permission.AGENDA,
        Permission.ATENDIMENTO,
      ]);
    },
  );

  /**
   * Escrever herda a exigência da classe (AGENDA) — a ausência de decorator
   * de método É a asserção, e por isso o teste checa `toBeUndefined` em vez
   * de aceitar um valor padrão.
   */
  it.each(['create', 'update', 'updateStatus', 'delete'] as const)(
    'deixa %s herdar agenda da classe',
    (metodo) => {
      expect(exigidoEm(metodo)).toBeUndefined();
    },
  );
});
