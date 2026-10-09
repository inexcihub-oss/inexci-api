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

  it.each([
    'findAgenda',
    'findByPatient',
    'findOne',
    'findActivities',
  ] as const)('aceita agenda ou atendimento na leitura: %s', (metodo) => {
    expect(exigidoEm(metodo)).toEqual([
      Permission.AGENDA,
      Permission.ATENDIMENTO,
    ]);
  });

  it.each([
    'create',
    'update',
    'updateStatus',
    'delete',
    'addComment',
  ] as const)('deixa %s herdar agenda da classe', (metodo) => {
    expect(exigidoEm(metodo)).toBeUndefined();
  });
});
