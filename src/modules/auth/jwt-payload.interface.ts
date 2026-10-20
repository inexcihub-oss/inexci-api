export interface JwtPayload {
  userId: string;
  tv?: number;
  purpose?: string;
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
}

export const JWT_DEFAULT_ISSUER = 'inexci-api';
export const JWT_DEFAULT_AUDIENCE = 'inexci-app';

export function tokenVersionValida(
  payload: Pick<JwtPayload, 'tv'>,
  tokenVersionAtual: number | null | undefined,
): boolean {
  return (payload.tv ?? 0) === (tokenVersionAtual ?? 0);
}
