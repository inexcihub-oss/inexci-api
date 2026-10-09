export interface JwtPayload {
  userId: string;
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
}

export const JWT_DEFAULT_ISSUER = 'inexci-api';
export const JWT_DEFAULT_AUDIENCE = 'inexci-app';
