/**
 * Campos de credencial do `User`. São os mesmos marcados com `@Exclude()` na
 * entidade — a lista vive aqui de novo porque o `ClassSerializerInterceptor`
 * global só honra o decorator quando a resposta é **instância** da classe.
 * Todo service que faz `{ ...user, algoAMais }` devolve um objeto literal, o
 * interceptor passa batido e o hash bcrypt da senha vai no corpo da resposta.
 */
export const USER_SECRET_FIELDS = [
  'password',
  'emailVerificationToken',
  'emailVerificationExpiresAt',
] as const;

export type UserSecretField = (typeof USER_SECRET_FIELDS)[number];

/**
 * Remove os campos de credencial de um objeto de usuário antes de ele virar
 * corpo de resposta. Use sempre que a resposta deixar de ser a entidade crua
 * (spread, campos extras, DTO montado à mão).
 */
export function omitUserSecrets<T extends object>(
  user: T,
): Omit<T, UserSecretField> {
  const copia = { ...(user as Record<string, unknown>) };
  for (const campo of USER_SECRET_FIELDS) {
    delete copia[campo];
  }
  return copia as Omit<T, UserSecretField>;
}
