import type { PlatformSecurityEventType } from 'src/database/entities/platform-security-daily.entity';

export interface PlatformSecurityEvent {
  type: PlatformSecurityEventType;
  userId?: string | null;
  ownerId?: string | null;
  email?: string | null;
}

type PlatformSecuritySink = (event: PlatformSecurityEvent) => void;

let sink: PlatformSecuritySink | null = null;

export function registerPlatformSecuritySink(
  next: PlatformSecuritySink | null,
): void {
  sink = next;
}

export function reportSecurityEvent(event: PlatformSecurityEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch {}
}
