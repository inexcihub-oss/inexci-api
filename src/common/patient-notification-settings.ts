export interface PatientNotificationSettings {
  appointmentScheduled: boolean;
  appointmentReminder: boolean;
  appointmentCancelled: boolean;
}

export type PatientNotificationKind = keyof PatientNotificationSettings;

export const PATIENT_NOTIFICATION_KINDS: readonly PatientNotificationKind[] = [
  'appointmentScheduled',
  'appointmentReminder',
  'appointmentCancelled',
];

export const DEFAULT_PATIENT_NOTIFICATION_SETTINGS: Readonly<PatientNotificationSettings> =
  Object.freeze({
    appointmentScheduled: true,
    appointmentReminder: true,
    appointmentCancelled: true,
  });

export function resolvePatientNotificationSettings(
  raw: Partial<PatientNotificationSettings> | null | undefined,
): PatientNotificationSettings {
  const resolved = { ...DEFAULT_PATIENT_NOTIFICATION_SETTINGS };
  for (const kind of PATIENT_NOTIFICATION_KINDS) {
    const value = raw?.[kind];
    if (typeof value === 'boolean') resolved[kind] = value;
  }
  return resolved;
}
