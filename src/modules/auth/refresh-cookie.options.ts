import type { CookieOptions } from 'express';

export type RefreshCookieFlags = Pick<
  CookieOptions,
  'httpOnly' | 'secure' | 'sameSite' | 'domain'
>;

export function refreshCookieFlags(
  env: NodeJS.ProcessEnv = process.env,
): RefreshCookieFlags {
  const configuredSameSite =
    env.AUTH_REFRESH_COOKIE_SAMESITE?.trim().toLowerCase();
  const sameSite: CookieOptions['sameSite'] =
    configuredSameSite === 'lax' ||
    configuredSameSite === 'strict' ||
    configuredSameSite === 'none'
      ? configuredSameSite
      : env.NODE_ENV === 'production'
        ? 'lax'
        : 'strict';

  const secureFromEnv = env.AUTH_REFRESH_COOKIE_SECURE?.trim();
  const secure =
    secureFromEnv === 'true'
      ? true
      : secureFromEnv === 'false'
        ? false
        : env.NODE_ENV === 'production' || sameSite === 'none';

  const domain = env.AUTH_REFRESH_COOKIE_DOMAIN?.trim();

  return {
    httpOnly: true,
    secure,
    sameSite,
    ...(domain ? { domain } : {}),
  };
}
