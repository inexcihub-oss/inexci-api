import {
  DEFAULT_PATIENT_NOTIFICATION_SETTINGS,
  resolvePatientNotificationSettings,
} from './patient-notification-settings';

describe('resolvePatientNotificationSettings', () => {
  it('liga tudo quando a conta nunca configurou (comportamento anterior)', () => {
    expect(resolvePatientNotificationSettings(null)).toEqual({
      appointmentScheduled: true,
      appointmentReminder: true,
      appointmentCancelled: true,
    });
    expect(resolvePatientNotificationSettings(undefined)).toEqual(
      DEFAULT_PATIENT_NOTIFICATION_SETTINGS,
    );
  });

  it('respeita o que foi gravado e completa o que falta', () => {
    expect(
      resolvePatientNotificationSettings({ appointmentReminder: false }),
    ).toEqual({
      appointmentScheduled: true,
      appointmentReminder: false,
      appointmentCancelled: true,
    });
  });

  it('descarta chaves desconhecidas e valores não booleanos', () => {
    expect(
      resolvePatientNotificationSettings({
        appointmentCancelled: 'nao' as unknown as boolean,
        outra: false,
      } as never),
    ).toEqual(DEFAULT_PATIENT_NOTIFICATION_SETTINGS);
  });
});
