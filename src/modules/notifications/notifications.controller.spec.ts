import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController — avisos ao paciente', () => {
  const permissoesDe = (metodo: keyof NotificationsController) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      NotificationsController.prototype[metodo],
    );

  it('GET e PUT /notifications/patient-settings exigem ADMINISTRACAO', () => {
    expect(permissoesDe('getPatientSettings')).toEqual([
      Permission.ADMINISTRACAO,
    ]);
    expect(permissoesDe('updatePatientSettings')).toEqual([
      Permission.ADMINISTRACAO,
    ]);
  });

  it('as preferências pessoais continuam abertas a qualquer autenticado', () => {
    expect(permissoesDe('getSettings')).toBeUndefined();
  });

  it('escopa a configuração pela conta (ownerId) do usuário', async () => {
    const service = {
      getPatientSettings: jest.fn().mockResolvedValue({}),
      updatePatientSettings: jest.fn().mockResolvedValue({}),
    };
    const controller = new NotificationsController(
      service as unknown as NotificationsService,
    );
    const user = {
      userId: 'delegado',
      ownerId: 'dono',
      role: 'collaborator',
      permissions: [Permission.ADMINISTRACAO],
    } as never;

    await controller.getPatientSettings(user);
    await controller.updatePatientSettings(
      { appointmentReminder: false },
      user,
    );

    expect(service.getPatientSettings).toHaveBeenCalledWith('dono');
    expect(service.updatePatientSettings).toHaveBeenCalledWith('dono', {
      appointmentReminder: false,
    });
  });
});
