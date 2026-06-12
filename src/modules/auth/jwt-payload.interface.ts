/**
 * Payload assinado nos access tokens. Mantido mínimo: a verdade vem do banco
 * (revalidado a cada request em `JwtStrategy.validate`).
 */
export interface JwtPayload {
  userId: string;
  /** issuer — preenchido pelo JwtModule no sign. */
  iss?: string;
  /** audience — preenchido pelo JwtModule no sign. */
  aud?: string;
  /** issued at (epoch seconds). */
  iat?: number;
  /** expiration (epoch seconds). */
  exp?: number;
}

/** Defaults de issuer/audience usados no sign e na verificação. */
export const JWT_DEFAULT_ISSUER = 'inexci-api';
export const JWT_DEFAULT_AUDIENCE = 'inexci-app';
