import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof NotificationsController) =>
    reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      NotificationsController.prototype[metodo],
    );

  // Desligar um aviso vale para todos os pacientes da conta: é decisão da
  // administração, não preferência pessoal (essa vive em `settings`).
  it.each(['getPatientSettings', 'updatePatientSettings'] as const)(
    'exige administração em %s',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
    },
  );

  it('preferências pessoais continuam liberadas para qualquer autenticado', () => {
    expect(exigidoEm('getSettings')).toBeUndefined();
    expect(exigidoEm('updateSettings')).toBeUndefined();
  });

  it('as rotas da conta resolvem pelo usuário logado', async () => {
    const patientSettings = {
      getForUser: jest.fn().mockResolvedValue({ appointmentReminder: true }),
      updateForUser: jest
        .fn()
        .mockResolvedValue({ appointmentReminder: false }),
    };
    const controller = new NotificationsController(
      {} as any,
      patientSettings as any,
    );
    const user = { userId: 'u1' } as any;

    await controller.getPatientSettings(user);
    await controller.updatePatientSettings(
      { appointmentReminder: false },
      user,
    );

    expect(patientSettings.getForUser).toHaveBeenCalledWith('u1');
    expect(patientSettings.updateForUser).toHaveBeenCalledWith('u1', {
      appointmentReminder: false,
    });
  });
});
