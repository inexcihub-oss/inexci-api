import type { PlatformSecurityEventType } from 'src/database/entities/platform-security-daily.entity';

export const SECURITY_PERIOD_DAYS = [1, 7, 30, 90] as const;

export const LOGIN_FAILURE_SPIKE_PER_ACCOUNT = 10;

export const LOGIN_FAILURE_SPIKE_PLATFORM = 50;

export const SECURITY_TOP_ACCOUNTS = 10;

export const SECURITY_SPIKE_TOP = 5;

export const SECURITY_LOG_MARKER = 'AUTH_';

export const SECURITY_LOG_USERS = 20;

export const SECURITY_LOG_LINES = 50;

export const FAILURE_EVENTS: PlatformSecurityEventType[] = [
  'login_failed',
  'login_locked',
  'mfa_failed',
];

export const SESSION_REVOKING_EVENTS: PlatformSecurityEventType[] = [
  'refresh_reuse',
  'password_changed',
  'mfa_disabled',
];
