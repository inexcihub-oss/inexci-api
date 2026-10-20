export const USER_SECRET_FIELDS = [
  'password',
  'emailVerificationToken',
  'emailVerificationExpiresAt',
] as const;

export type UserSecretField = (typeof USER_SECRET_FIELDS)[number];

export function omitUserSecrets<T extends object>(
  user: T,
): Omit<T, UserSecretField> {
  const copia = { ...(user as Record<string, unknown>) };
  for (const campo of USER_SECRET_FIELDS) {
    delete copia[campo];
  }
  return copia as Omit<T, UserSecretField>;
}
